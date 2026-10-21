import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RuntimeError } from './errors.js';
import { createWindowsJobCommand, createPowerShellScript } from './windows-job.js';

type ProcessStatus = 'running' | 'exited' | 'signaled' | 'failed';

interface ManagedProcess {
  id: string;
  child: ChildProcess;
  command: string;
  cwd: string;
  startedAt: string;
  finishedAt?: string;
  status: ProcessStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
  done: Promise<void>;
}

interface ShellOptions {
  cwd: string;
  env?: Record<string, string>;
}

const MAX_TAIL_CHARS = 1_000_000;
const MAX_RECORDS = 128;
const forbiddenElevatedCommand = new RegExp('(^|[\\s;&|()])(?:su' + 'do|su' + 'do\\.exe)(?=$|[\\s;&|()])', 'i');

function appendTail(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length > MAX_TAIL_CHARS ? next.slice(-MAX_TAIL_CHARS) : next;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();

  async exec(
    command: string,
    options: ShellOptions & { timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    const record = this.spawn(command, options);
    const timeoutMs = options.timeoutMs ?? 120_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (record.status !== 'running') return;
      timedOut = true;
      void this.killTree(record).catch((error: unknown) => {
        record.error = String(error);
      });
    }, timeoutMs);
    timer.unref();

    await record.done;
    clearTimeout(timer);
    return { ...this.snapshot(record), timed_out: timedOut, timeout_ms: timeoutMs };
  }

  start(command: string, options: ShellOptions): Record<string, unknown> {
    return this.snapshot(this.spawn(command, options));
  }

  poll(processId: string): Record<string, unknown> {
    return this.snapshot(this.require(processId));
  }

  write(processId: string, input: string, eof = false): Record<string, unknown> {
    const record = this.require(processId);
    if (record.status !== 'running' || !record.child.stdin?.writable) {
      throw new RuntimeError('PROCESS_STDIN_CLOSED', 'Process stdin is not writable.', {
        process_id: processId,
        status: record.status,
      });
    }
    record.child.stdin.write(input);
    if (eof) record.child.stdin.end();
    return {
      process_id: processId,
      written_bytes: Buffer.byteLength(input),
      stdin_closed: eof,
    };
  }

  async stop(processId: string): Promise<Record<string, unknown>> {
    const record = this.require(processId);
    if (record.status === 'running') {
      await this.killTree(record);
      await Promise.race([record.done, delay(3_000)]);
      if (record.status === 'running') {
        record.child.kill();
        await Promise.race([record.done, delay(2_000)]);
        if (record.status === 'running') {
          throw new RuntimeError('PROCESS_STOP_FAILED', 'Could not stop the managed process.', {
            process_id: processId,
            pid: record.child.pid,
          });
        }
      }
    }
    return this.snapshot(record);
  }

  async shutdown(): Promise<void> {
    const running = [...this.processes.values()].filter((record) => record.status === 'running');
    const results = await Promise.allSettled(running.map((record) => this.stop(record.id)));
    const failure = results.find((item) => item.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  private spawn(command: string, options: ShellOptions): ManagedProcess {
    if (!command.trim()) {
      throw new RuntimeError('EMPTY_COMMAND', 'Shell command must not be empty.');
    }
    if (forbiddenElevatedCommand.test(command)) {
      throw new RuntimeError('SUDO_DISABLED', 'Direct privilege elevation is disabled.', { command });
    }
    if (process.platform !== 'win32') {
      throw new RuntimeError('WINDOWS_REQUIRED', 'PowerShell process execution requires Windows.');
    }

    const id = randomUUID();
    // The user command is written to a unique UTF-8 BOM script in the OS temp
    // directory so long engineering commands cannot hit the Windows command
    // line length limit. Only the fixed Job Object supervisor is encoded.
    const scriptPath = join(tmpdir(), `catkov-${id}.ps1`);
    writeFileSync(scriptPath, '\uFEFF' + createPowerShellScript(command), {
      encoding: 'utf8',
      mode: 0o600,
    });
    let child: ChildProcess;
    try {
      child = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', createWindowsJobCommand(scriptPath),
      ], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      unlinkSync(scriptPath);
      throw error;
    }
    const cleanupScript = () => {
      try { unlinkSync(scriptPath); } catch { /* already cleaned */ }
    };

    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const record: ManagedProcess = {
      id, child, command, cwd: options.cwd,
      startedAt: new Date().toISOString(),
      status: 'running', exitCode: null, signal: null,
      stdout: '', stderr: '', done,
    };
    this.processes.set(id, record);
    this.prune();

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      record.stdout = appendTail(record.stdout, chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      record.stderr = appendTail(record.stderr, chunk);
    });
    child.stdin?.on('error', () => {});
    child.on('error', (error) => {
      cleanupScript();
      record.status = 'failed';
      record.error = error.message;
      record.finishedAt = new Date().toISOString();
      resolveDone();
    });
    child.on('close', (code, signal) => {
      cleanupScript();
      record.exitCode = code;
      record.signal = signal;
      if (record.status !== 'failed') record.status = signal ? 'signaled' : 'exited';
      record.finishedAt = new Date().toISOString();
      resolveDone();
    });
    return record;
  }

  private require(processId: string): ManagedProcess {
    const record = this.processes.get(processId);
    if (!record) {
      throw new RuntimeError('PROCESS_NOT_FOUND', 'Managed process does not exist.', {
        process_id: processId,
      });
    }
    return record;
  }

  private async killTree(record: ManagedProcess): Promise<void> {
    if (record.status !== 'running') return;
    if (!record.child.pid) {
      record.child.kill();
      return;
    }
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(record.child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => { record.child.kill(); resolve(); });
      killer.once('close', (code) => {
        if (code !== 0 && record.status === 'running') record.child.kill();
        resolve();
      });
    });
  }

  private snapshot(record: ManagedProcess): Record<string, unknown> {
    return {
      process_id: record.id,
      command: record.command,
      cwd: record.cwd,
      pid: record.child.pid ?? null,
      status: record.status,
      exit_code: record.exitCode,
      signal: record.signal,
      started_at: record.startedAt,
      finished_at: record.finishedAt ?? null,
      stdout: record.stdout,
      stderr: record.stderr,
      error: record.error ?? null,
    };
  }

  private prune(): void {
    if (this.processes.size <= MAX_RECORDS) return;
    for (const [id, record] of this.processes) {
      if (this.processes.size <= MAX_RECORDS) break;
      if (record.status !== 'running') this.processes.delete(id);
    }
  }
}
