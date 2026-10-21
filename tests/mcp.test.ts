import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as z from 'zod/v4';
import { RuntimeError } from '../src/errors.js';
import { startHttpRuntime } from '../src/http-runtime.js';
import { defineTool, ToolRegistry } from '../src/tool-registry.js';
import { runTool } from '../src/tool-result.js';

async function rpc(url: string, id: number, method: string, params: object) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  const data = body.split('\n').find(line => line.startsWith('data: '));
  const parsed = JSON.parse(data ? data.slice(6) : body) as { result?: Record<string, unknown>; error?: unknown };
  assert.equal(parsed.error, undefined, body);
  assert.ok(parsed.result);
  return parsed.result;
}

test('health, initialize, list and all four real MCP tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catkov mcp '));
  await writeFile(join(root, 'file.txt'), 'Ветка 🐚', 'utf8');
  const runtime = await startHttpRuntime({ port: 0 });
  const url = `http://127.0.0.1:${runtime.port}/mcp`;
  try {
    const health = await fetch(`http://127.0.0.1:${runtime.port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { runtime: string }).runtime, 'catkov');
    const initialized = await rpc(url, 1, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'catkov-smoke', version: '1.0.0' },
    });
    assert.equal((initialized.serverInfo as { name: string }).name, 'catkov');
    const listed = await rpc(url, 2, 'tools/list', {});
    const names = (listed.tools as Array<{name: string}>).map(t=>t.name);
    assert.deepEqual(names, ['runtime_context', 'workspace_context', 'workspace_read_text', 'shell']);
    const context = (await rpc(url, 3, 'tools/call', { name: 'runtime_context', arguments: {} }))
      .structuredContent as { runtime: string; tool_inventory: string[]; capabilities: string[]; shell: string };
    assert.equal(context.runtime, 'catkov');
    assert.deepEqual(context.tool_inventory, names);
    assert.deepEqual(context.capabilities, [
      'runtime_context', 'workspace_context', 'workspace_read_text',
      'shell.exec', 'shell.start', 'shell.poll', 'shell.write', 'shell.stop',
    ]);
    assert.equal(context.shell, 'powershell.exe');
    const wc = (await rpc(url, 4, 'tools/call', {
      name: 'workspace_context', arguments: { root },
    })).structuredContent as { workspace_root: string };
    assert.equal(wc.workspace_root, await realpath(root));
    const read = (await rpc(url, 5, 'tools/call', {
      name: 'workspace_read_text', arguments: { root, path: 'file.txt' },
    })).structuredContent as { content: string };
    assert.equal(read.content, 'Ветка 🐚');
    // Shell validation path exercises the MCP tool even on non-Windows hosts.
    const shell = await rpc(url, 6, 'tools/call', {
      name: 'shell', arguments: { action: 'exec', command: 'Write-Output ok' },
    });
    assert.equal(shell.isError, true);
    assert.equal((shell.structuredContent as {error:{code:string}}).error.code, 'WORKSPACE_ROOT_REQUIRED');
    if (process.platform === 'win32') {
      const executed = (await rpc(url, 7, 'tools/call', {
        name: 'shell', arguments: { action: 'exec', root, command: 'Write-Output ok', timeout_ms: 30_000 },
      })).structuredContent as { stdout: string; exit_code: number; status: string; error: string|null };
      assert.equal(executed.status, 'exited');
      assert.equal(executed.exit_code, 0, String(executed.error));
      assert.equal(executed.stdout.trim(), 'ok');
    }
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('registry enforces unique tool names and unique runtime capability names', () => {
  const registry = new ToolRegistry();
  const make = (name: string, capability: string) => defineTool({
    name, description: 'probe', inputSchema: z.object({}),
    runtimeCapabilities: [capability],
    handler: async () => runTool(() => ({ ok: true })),
  });
  registry.register(make('one','probe'));
  assert.throws(() => registry.register(make('one','second')),
    (err: unknown) => err instanceof RuntimeError && err.code === 'DUPLICATE_TOOL_NAME');
  assert.throws(() => registry.register(make('two','probe')),
    (err: unknown) => err instanceof RuntimeError && err.code === 'DUPLICATE_RUNTIME_CAPABILITY');
});
