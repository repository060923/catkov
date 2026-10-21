import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { RuntimeError } from '../src/errors.js';
import { WorkspaceManager } from '../src/workspace.js';

test('workspace instructions are hierarchical, SHA verified and root-isolated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ракушка workspace '));
  const other = await mkdtemp(join(tmpdir(), 'catkov other '));
  try {
    await mkdir(join(root, 'sub dir', 'тест'), { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), 'root ✨', 'utf8');
    await writeFile(join(root, 'sub dir', 'AGENTS.md'), 'nested', 'utf8');
    await writeFile(join(root, 'sub dir', 'тест', 'файл.txt'), 'Привет, 世界', 'utf8');
    const manager = await WorkspaceManager.create(other);
    const data = await manager.instructionContext('sub dir/тест/файл.txt', root) as {
      workspace_root: string;
      runtime_instructions: { runtime: string; authority: string };
      project_instructions: { authority: string; files: Array<{ path: string; sha256: string; content: string }> };
    };
    assert.equal(data.workspace_root, await realpath(root));
    assert.equal(data.runtime_instructions.runtime, 'catkov');
    assert.equal(data.runtime_instructions.authority, 'runtime');
    assert.equal(data.project_instructions.authority, 'project');
    assert.deepEqual(data.project_instructions.files.map(x=>x.path), ['AGENTS.md', join('sub dir','AGENTS.md')]);
    assert.equal(data.project_instructions.files[0]?.sha256, createHash('sha256').update('root ✨').digest('hex'));
    const read = await manager.readText('sub dir/тест/файл.txt', undefined, root) as {
      content: string; sha256: string; bytes: number; absolute_path: string;
    };
    assert.equal(read.content, 'Привет, 世界');
    assert.equal(read.bytes, Buffer.byteLength(read.content));
    assert.equal(read.sha256, createHash('sha256').update(read.content).digest('hex'));
    assert.equal(read.absolute_path, resolve(await realpath(root), 'sub dir/тест/файл.txt'));
    const absoluteRead = await manager.readText(join(root,'sub dir/тест/файл.txt'));
    assert.equal(absoluteRead.content, read.content);
    assert.equal(manager.currentRoot(), await realpath(other));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});

test('read-text rejects missing, binary, oversized, malformed UTF-8 and unsafe paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catkov-errors-'));
  try {
    await writeFile(join(root, 'binary.bin'), Buffer.from([0,1,2]));
    await writeFile(join(root, 'bad.txt'), Buffer.from([0xc3,0x28]));
    await writeFile(join(root, 'long.txt'), 'a'.repeat(1200));
    const workspace = await WorkspaceManager.create(root);
    async function code(operation: Promise<unknown>, expected: string) {
      await assert.rejects(operation, (e: unknown) => e instanceof RuntimeError && e.code === expected);
    }
    await code(workspace.readText('long.txt'), 'WORKSPACE_ROOT_REQUIRED');
    await code(workspace.readText('missing.txt', undefined, root), 'FILE_NOT_FOUND');
    await code(workspace.readText('binary.bin', undefined, root), 'BINARY_FILE');
    await code(workspace.readText('bad.txt', undefined, root), 'INVALID_UTF8');
    await code(workspace.readText('long.txt', 1000, root), 'FILE_TOO_LARGE');
    await code(workspace.readText('../escape.txt', undefined, root), 'PATH_OUTSIDE_WORKSPACE');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
