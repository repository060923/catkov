import { createHash } from 'node:crypto';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { RuntimeError } from './errors.js';
import { RUNTIME_INSTRUCTIONS, RUNTIME_NAME } from './constants.js';

const DEFAULT_MAX_READ_BYTES = 2_000_000;

export interface ProjectInstructionFile {
  path: string;
  sha256: string;
  content: string;
}

export class WorkspaceManager {
  private constructor(private readonly rootPath: string) {}

  static async create(initialRoot?: string): Promise<WorkspaceManager> {
    const root = await WorkspaceManager.requireDirectory(
      initialRoot ?? process.env.CATKOV_WORKSPACE ?? process.cwd(),
    );
    return new WorkspaceManager(root);
  }

  currentRoot(): string {
    return this.rootPath;
  }


  async resolveInside(path: string): Promise<string> {
    return WorkspaceManager.resolveWithin(this.rootPath, path);
  }

  async resolveInsideRoot(root: string, path: string): Promise<string> {
    const canonicalRoot = await WorkspaceManager.requireDirectory(root);
    return WorkspaceManager.resolveWithin(canonicalRoot, path);
  }

  async resolveShellCwd(cwd?: string, root?: string): Promise<string> {
    const workspaceRoot = root
      ? await WorkspaceManager.requireDirectory(root)
      : this.rootPath;
    const candidate = cwd
      ? isAbsolute(cwd)
        ? cwd
        : resolve(workspaceRoot, cwd)
      : workspaceRoot;
    return WorkspaceManager.requireDirectory(candidate);
  }

  async readText(
    path: string,
    maxBytes = DEFAULT_MAX_READ_BYTES,
    root?: string,
  ): Promise<Record<string, unknown>> {
    let workspaceRoot: string | null;
    let absolute: string;
    if (root) {
      workspaceRoot = await WorkspaceManager.requireDirectory(root);
      absolute = WorkspaceManager.resolveWithin(workspaceRoot, path);
    } else if (isAbsolute(path)) {
      workspaceRoot = null;
      absolute = resolve(path);
    } else {
      throw new RuntimeError(
        'WORKSPACE_ROOT_REQUIRED',
        'Relative read paths require an explicit workspace root.',
        { path, required_action: 'provide_root_or_absolute_path' },
      );
    }
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) {
      throw new RuntimeError('FILE_NOT_FOUND', 'Text file does not exist.', { path });
    }
    if (info.size > maxBytes) {
      throw new RuntimeError('FILE_TOO_LARGE', 'File exceeds the requested read limit.', {
        path,
        size: info.size,
        max_bytes: maxBytes,
      });
    }

    const bytes = await readFile(absolute);
    if (bytes.includes(0)) {
      throw new RuntimeError('BINARY_FILE', 'Binary files are not supported by the text read tool.', { path });
    }
    let content: string;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      content = bytes.toString('utf8');
    } catch {
      throw new RuntimeError('INVALID_UTF8', 'File is not valid UTF-8 text.', { path });
    }
    return {
      path,
      workspace_root: workspaceRoot,
      absolute_path: absolute,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      content,
    };
  }

  async sha256(path: string, root?: string): Promise<string> {
    const workspaceRoot = root
      ? await WorkspaceManager.requireDirectory(root)
      : this.rootPath;
    const absolute = WorkspaceManager.resolveWithin(workspaceRoot, path);
    const bytes = await readFile(absolute).catch(() => null);
    if (!bytes) {
      throw new RuntimeError('FILE_NOT_FOUND', 'Expected file does not exist.', { path });
    }
    return createHash('sha256').update(bytes).digest('hex');
  }

  async instructionContext(targetPath = '.', root?: string): Promise<Record<string, unknown>> {
    const workspaceRoot = root
      ? await WorkspaceManager.requireDirectory(root)
      : this.rootPath;
    const absoluteTarget = WorkspaceManager.resolveWithin(workspaceRoot, targetPath);
    const targetInfo = await stat(absoluteTarget).catch(() => null);
    const targetDirectory = targetInfo?.isFile() ? dirname(absoluteTarget) : absoluteTarget;
    const rel = relative(workspaceRoot, targetDirectory);
    const segments = rel && rel !== '.' ? rel.split(sep) : [];
    const directories = [workspaceRoot];
    let cursor = workspaceRoot;
    for (const segment of segments) {
      cursor = resolve(cursor, segment);
      directories.push(cursor);
    }

    const files: ProjectInstructionFile[] = [];
    for (const directory of directories) {
      const agentsPath = resolve(directory, 'AGENTS.md');
      try {
        await access(agentsPath);
      } catch {
        continue;
      }
      const bytes = await readFile(agentsPath);
      files.push({
        path: relative(workspaceRoot, agentsPath) || 'AGENTS.md',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        content: bytes.toString('utf8'),
      });
    }

    return {
      workspace_root: workspaceRoot,
      target_path: targetPath,
      runtime_instructions: {
        authority: 'runtime',
        runtime: RUNTIME_NAME,
        content: RUNTIME_INSTRUCTIONS,
      },
      project_instructions: {
        authority: 'project',
        files,
      },
    };
  }

  private static resolveWithin(root: string, path: string): string {
    const candidate = resolve(root, path);
    const rel = relative(root, candidate);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new RuntimeError('PATH_OUTSIDE_WORKSPACE', 'Path is outside the selected workspace root.', {
        path,
        workspace_root: root,
      });
    }
    return candidate;
  }

  private static async requireDirectory(path: string): Promise<string> {
    const absolute = await realpath(resolve(path)).catch(() => null);
    if (!absolute) {
      throw new RuntimeError('DIRECTORY_NOT_FOUND', 'Directory does not exist.', { path });
    }
    const info = await stat(absolute);
    if (!info.isDirectory()) {
      throw new RuntimeError('NOT_A_DIRECTORY', 'Path is not a directory.', { path: absolute });
    }
    return absolute;
  }
}
