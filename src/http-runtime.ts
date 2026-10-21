import { createServer, type Server } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { RuntimeKernel } from './kernel.js';
import { createRuntimeServer } from './server.js';
import { RUNTIME_NAME, RUNTIME_VERSION } from './constants.js';

export interface HttpRuntimeOptions {
  host?: string;
  port?: number;
  shutdownTimeoutMs?: number;
}

export interface RunningHttpRuntime {
  host: string;
  port: number;
  server: Server;
  kernel: RuntimeKernel;
  close(): Promise<void>;
}

export async function startHttpRuntime(options: HttpRuntimeOptions = {}): Promise<RunningHttpRuntime> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8791;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('HTTP runtime port must be an integer between 0 and 65535.');
  }
  if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 500) {
    throw new Error('HTTP runtime shutdown timeout must be an integer >= 500ms.');
  }

  const kernel = await RuntimeKernel.create();
  const mcpHandler = createMcpHandler(() => createRuntimeServer(kernel));
  const nodeMcpHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => console.error('[catkov] MCP adapter error', error),
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'ok',
        runtime: RUNTIME_NAME,
        version: RUNTIME_VERSION,
        pid: process.pid,
        workspace_root: kernel.workspace.currentRoot(),
      }));
      return;
    }

    if (url.pathname === '/mcp') {
      void nodeMcpHandler(req, res).catch((error) => {
        console.error('[catkov] MCP request failed', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        }
        if (!res.writableEnded) res.end(JSON.stringify({ error: 'internal_error' }));
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  }).catch(async (error: NodeJS.ErrnoException) => {
    await Promise.allSettled([mcpHandler.close(), kernel.shutdown()]);
    if (error.code === 'EADDRINUSE') {
      throw new Error(`ADDRESS_IN_USE ${host}:${port}`);
    }
    throw error;
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  let closed = false;

  return {
    host,
    port: boundPort,
    server,
    kernel,
    async close() {
      if (closed) return;
      closed = true;

      const deadline = Date.now() + shutdownTimeoutMs;
      const serverClosed = new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
      });
      const waitWithinDeadline = async (promise: Promise<unknown>): Promise<boolean> => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        let timer: NodeJS.Timeout | undefined;
        try {
          return await Promise.race([
            promise.then(() => true, () => true),
            new Promise<boolean>((resolve) => {
              timer = setTimeout(() => resolve(false), remaining);
              timer.unref();
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      await waitWithinDeadline(kernel.shutdown());
      server.closeAllConnections?.();
      await waitWithinDeadline(Promise.allSettled([mcpHandler.close(), serverClosed]));
    },
  };
}
