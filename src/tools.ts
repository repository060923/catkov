import { isAbsolute } from 'node:path';
import { CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY, type ServerContext } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { RuntimeError } from './errors.js';
import type { RuntimeKernel } from './kernel.js';
import { defineTool, type ToolRegistry } from './tool-registry.js';
import { runTool } from './tool-result.js';

function requestOrigin(ctx: ServerContext): Record<string, unknown> {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const request = ctx.http?.req;
  return {
    client_info: envelope?.[CLIENT_INFO_META_KEY] ?? null,
    protocol_version: envelope?.[PROTOCOL_VERSION_META_KEY] ?? request?.headers.get('mcp-protocol-version') ?? null,
    user_agent: request?.headers.get('user-agent') ?? null,
    host: request?.headers.get('host') ?? null,
    forwarded_host: request?.headers.get('x-forwarded-host') ?? null,
    forwarded_proto: request?.headers.get('x-forwarded-proto') ?? null,
  };
}

const shellSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('exec'),
    command: z.string().min(1),
    root: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeout_ms: z.number().int().min(1_000).max(600_000).optional(),
  }),
  z.object({
    action: z.literal('start'),
    command: z.string().min(1),
    root: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    action: z.literal('poll'),
    process_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal('write'),
    process_id: z.string().uuid(),
    input: z.string(),
    eof: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('stop'),
    process_id: z.string().uuid(),
  }),
]);

export function registerCoreToolDefinitions(registry: ToolRegistry, kernel: RuntimeKernel): void {
  registry.register(defineTool({
    name: 'runtime_context',
    description: 'Return the effective local engineering runtime, workspace, shell, trust model, and available core capabilities.',
    inputSchema: z.object({}),
    handler: async (_input, ctx) => runTool(() => ({
      ...kernel.context(),
      request_origin: requestOrigin(ctx),
    })),
  }));

  registry.register(defineTool({
    name: 'workspace_context',
    description: 'Resolve an existing local workspace and return the applicable AGENTS.md chain without mutating process-global workspace state.',
    inputSchema: z.object({
      root: z.string().min(1).optional(),
      target_path: z.string().min(1).optional(),
    }),
    handler: async ({ root, target_path }) =>
      runTool(async () => kernel.workspace.instructionContext(target_path ?? '.', root)),
  }));

  registry.register(defineTool({
    name: 'workspace_read_text',
    description: 'Read a text file using an explicit workspace root. Absolute paths are also accepted for compatibility with clients that have a cached older schema. Relative paths without root are rejected.',
    inputSchema: z.object({
      root: z.string().min(1).optional(),
      path: z.string().min(1),
      max_bytes: z.number().int().min(1_000).max(2_000_000).optional(),
    }),
    handler: async ({ root, path, max_bytes }) =>
      runTool(async () => kernel.workspace.readText(path, max_bytes, root)),
  }));

  registry.register(defineTool({
    name: 'shell',
    description: 'Execute or manage local Windows PowerShell processes with the current user permissions. Supports exec/start/poll/write/stop. Direct sudo invocation is disabled.',
    inputSchema: shellSchema,
    runtimeCapabilities: [
      'shell.exec',
      'shell.start',
      'shell.poll',
      'shell.write',
      'shell.stop',
    ],
    handler: async (input) =>
      runTool(async () => {
        if (input.action === 'poll') return kernel.processes.poll(input.process_id);
        if (input.action === 'write')
          return kernel.processes.write(input.process_id, input.input, input.eof ?? false);
        if (input.action === 'stop') return kernel.processes.stop(input.process_id);

        if (!input.root && (!input.cwd || !isAbsolute(input.cwd))) {
          throw new RuntimeError(
            'WORKSPACE_ROOT_REQUIRED',
            'shell exec/start require an explicit workspace root or an absolute cwd.',
            { action: input.action, required_action: 'provide_root_or_absolute_cwd' },
          );
        }
        const cwd = await kernel.workspace.resolveShellCwd(input.cwd, input.root);
        if (input.action === 'start') {
          return kernel.processes.start(input.command, { cwd, env: input.env });
        }
        return kernel.processes.exec(input.command, {
          cwd,
          env: input.env,
          timeoutMs: input.timeout_ms,
        });
      }),
  }));

}
