import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProcessManager } from '../src/process-manager.js';
import { startHttpRuntime } from '../src/http-runtime.js';
import { encodePowerShell, createWindowsJobCommand, createPowerShellScript } from '../src/windows-job.js';

const windows = process.platform === 'win32';

test('PowerShell encoded command preserves Unicode, quotes and Job Object primitives', () => {
  const original = "Write-Output 'Привет 世界'";
  const encoded = encodePowerShell(original);
  assert.equal(Buffer.from(encoded,'base64').toString('utf16le'), original);
  const userScript = createPowerShellScript(original);
  assert.match(userScript, /Привет 世界/);
  const supervisor = Buffer.from(createWindowsJobCommand('C:\\Users\\тест \\script.ps1'),'base64').toString('utf16le');
  assert.match(supervisor, /AssignProcessToJobObject/);
  assert.match(supervisor, /KILL_ON_JOB_CLOSE/);
  assert.match(supervisor, /CREATE_SUSPENDED/);
  assert.match(supervisor, /'@/);
  assert.match(supervisor, /-File/);
  assert.ok(createWindowsJobCommand('C:\\temp\\a.ps1').length < 30_000);
  assert.ok(createPowerShellScript('x'.repeat(40_000)).length > 40_000);
});

test('Windows exec captures stdout, stderr, native exit code, env and cwd', { skip: !windows }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'catkov кириллица test '));
  const manager = new ProcessManager();
  try {
    const ok = await manager.exec("Write-Output 'Привет'; [Console]::Error.WriteLine('ошибка')", {
      cwd: root, timeoutMs: 30_000,
    });
    assert.equal(ok.exit_code, 0, JSON.stringify(ok));
    assert.match(String(ok.stdout), /Привет/);
    assert.match(String(ok.stderr), /ошибка/);
    const failing = await manager.exec('exit 7', { cwd: root, timeoutMs: 30_000 });
    assert.equal(failing.exit_code, 7, JSON.stringify(failing));
    const variable = await manager.exec('Write-Output $env:CATKOV_PROBE; (Get-Location).Path', {
      cwd: root, env: { CATKOV_PROBE:'кириллица' }, timeoutMs: 30_000,
    });
    assert.equal(variable.exit_code, 0, JSON.stringify(variable));
    assert.match(String(variable.stdout), /кириллица/);
    assert.match(String(variable.stdout), /catkov кириллица test/);
  } finally {
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows start, poll, write, stop and timeout', { skip: !windows }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'catkov proc '));
  const manager = new ProcessManager();
  try {
    const script = join(root, 'stdin.js');
    await writeFile(script, "process.stdin.setEncoding('utf8');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(s.toUpperCase()));");
    const started = manager.start(`node '${script}'`, { cwd: root });
    const id = String(started.process_id);
    assert.equal(manager.poll(id).status, 'running');
    manager.write(id, 'hello', true);
    const limit = Date.now() + 30_000;
    while (manager.poll(id).status === 'running' && Date.now() < limit) {
      await new Promise(r=>setTimeout(r,50));
    }
    const finished = manager.poll(id);
    assert.equal(finished.exit_code, 0, JSON.stringify(finished));
    assert.equal(finished.stdout, 'HELLO');
    const long = manager.start('Start-Sleep -Seconds 40', {cwd: root});
    const stopped = await manager.stop(String(long.process_id));
    assert.notEqual(stopped.status, 'running');
    const timeout = await manager.exec('Start-Sleep -Seconds 40', { cwd: root, timeoutMs: 5_000 });
    assert.equal(timeout.timed_out, true, JSON.stringify(timeout));
  } finally {
    await manager.shutdown();
    await rm(root, {recursive:true, force:true});
  }
});

test('Windows job closes orphaned descendants after parent exits', { skip: !windows }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'catkov descendants '));
  const manager = new ProcessManager();
  try {
    const child = join(root, 'child.js');
    const launcher = join(root, 'launcher.js');
    await writeFile(child, "setInterval(()=>{},1000);");
    await writeFile(launcher, "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,[process.argv[2]],{stdio:'ignore',detached:true}); console.log(c.pid);c.unref();");
    const result = await manager.exec(`node '${launcher}' '${child}'`, {cwd: root, timeoutMs:30_000});
    assert.equal(result.exit_code, 0, JSON.stringify(result));
    const pid = Number(String(result.stdout).trim());
    assert.ok(pid > 0);
    await new Promise(r=>setTimeout(r,300));
    assert.throws(()=>process.kill(pid,0), {code:'ESRCH'});
  } finally {
    await manager.shutdown();
    await rm(root,{recursive:true,force:true});
  }
});

test('agent self-development cycle uses only exposed MCP reading and shell tools', { skip: !windows }, async () => {
  const root = process.cwd();
  const candidate = join(root, 'tests', 'self-development-probe.ts');
  const runtime = await startHttpRuntime({port: 0});
  const url = `http://127.0.0.1:${runtime.port}/mcp`;
  let id = 100;
  async function tool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: id++, method: 'tools/call', params: {name, arguments: args},
      }),
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    const line = raw.split('\n').find(text => text.startsWith('data: '));
    const result = JSON.parse(line ? line.slice(6) : raw) as {
      result: {isError?: boolean; structuredContent: Record<string, unknown>};
    };
    assert.equal(result.result.isError, undefined, raw);
    return result.result.structuredContent;
  }
  try {
    const inspected = await tool('workspace_read_text', {root, path:'src/tools.ts'});
    assert.match(String(inspected.content), /registerCoreToolDefinitions/);
    const command = `Set-Content -LiteralPath '${candidate}' -Encoding UTF8 -Value 'export const catkovProbe = 1;'`;
    const written = await tool('shell', {action:'exec', root, command, timeout_ms:60_000});
    assert.equal(written.exit_code, 0, JSON.stringify(written));
    const reread = await tool('workspace_read_text', {root, path:'tests/self-development-probe.ts'});
    assert.match(String(reread.content),/catkovProbe/);
    for (const command of ['npm run typecheck','npm run build']) {
      const built = await tool('shell', {action:'exec', root, command, timeout_ms:120_000});
      assert.equal(built.exit_code,0, JSON.stringify(built));
    }
  } finally {
    try {
      await tool('shell', {
        action:'exec', root,
        command:`Remove-Item -LiteralPath '${candidate}' -Force -ErrorAction SilentlyContinue`,
        timeout_ms:60_000,
      });
    } finally {
      await runtime.close();
      await rm(candidate, {force:true});
    }
  }
});
