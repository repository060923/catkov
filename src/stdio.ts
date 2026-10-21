import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { RuntimeKernel } from './kernel.js';
import { createRuntimeServer } from './server.js';

const kernel = await RuntimeKernel.create();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void kernel.shutdown().finally(() => process.exit(0));
  });
}

try {
  await serveStdio(() => createRuntimeServer(kernel));
} finally {
  await kernel.shutdown();
}
