import { McpServer } from '@modelcontextprotocol/server';
import { RUNTIME_INSTRUCTIONS, RUNTIME_NAME, RUNTIME_VERSION } from './constants.js';
import type { RuntimeKernel } from './kernel.js';

export function createRuntimeServer(kernel: RuntimeKernel): McpServer {
  const server = new McpServer(
    {
      name: RUNTIME_NAME,
      title: RUNTIME_NAME,
      version: RUNTIME_VERSION,
      description: 'Local autonomous software-engineering runtime.',
    },
    {
      capabilities: { tools: {} },
      instructions: RUNTIME_INSTRUCTIONS,
    },
  );

  kernel.tools.attach(server);
  return server;
}
