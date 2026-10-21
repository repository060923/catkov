import { startHttpRuntime } from './http-runtime.js';

const host = process.env.CATKOV_HOST ?? '127.0.0.1';
const requestedPort = Number.parseInt(process.env.CATKOV_PORT ?? '8791', 10);
const runtime = await startHttpRuntime({ host, port: requestedPort });

async function shutdown(signal: string): Promise<void> {
  console.error(`[catkov] shutting down (${signal})`);
  await runtime.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

console.error(`[catkov] MCP listening on http://${runtime.host}:${runtime.port}/mcp`);
