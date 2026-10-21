# Verification — 2026-10-21

Project: **catkov**. Target: Windows 10/11 x64, Node.js 20+.

Verification host: macOS (Darwin 24.6.0), Node.js v24.7.0, npm 11.5.1. No native Windows host or Windows PowerShell available in this session.

| Check | Observed result on macOS | Native Windows |
| --- | --- | --- |
| `npm ci` | PASS | Not run |
| `npm run typecheck` | PASS | Not run |
| `npm test` | PASS: 9 tests total, 5 passed, 4 Windows-specific skipped, 0 failed | Not run |
| Clean `dist` + `npm run build` | PASS | Not run |
| Real HTTP `/health` | PASS: `runtime: catkov` | Not run |
| HTTP MCP `initialize` | PASS: server name `catkov` | Not run |
| HTTP MCP `tools/list` | PASS: exactly `runtime_context`, `workspace_context`, `workspace_read_text`, `shell` | Not run |
| HTTP MCP `tools/call` `runtime_context` | PASS: identity `catkov`; shell actions `exec`, `start`, `poll`, `write`, `stop` | Not run |
| HTTP MCP workspace tools | PASS: workspace context and UTF-8/Unicode text read in automated tests | Not run |
| HTTP MCP `shell` | PASS: structured root-validation error; no command execution on macOS | Not run |
| Built JS server executable (`dist/src/http.js`) | PASS: independent `/health`, `initialize`, `tools/list`, `runtime_context` HTTP smoke | Not run |
| Old identity in tracked files and fresh `dist` | No matches at verification | Not applicable |
| PowerShell execution, UTF-8 I/O, interactive stdin, timeout, Job Object/descendant termination, self-development | Not executable on macOS; 4 tests skipped | **Not tested** |

The original ToolDefinition → ToolRegistry → MCP Server → RuntimeKernel flow and the existing Windows ProcessManager/Job Object launcher are preserved. No extra MCP tools, external runtime dependencies, ngrok configuration or public transport were added. The project is not published.

Dependency audit after `npm ci`: **one high-severity vulnerability** flagged in `@modelcontextprotocol/server@2.0.0` (SDK advisory range below 2.3.0). The dependency is deliberately unchanged in this identity-only migration. Upgrade and retest before exposing the server beyond trusted local access. Default transport listens on `127.0.0.1`.

**Scope of conclusion:** macOS contract checks and compiled-server smoke tests passed. Full Windows compatibility and process-tree cleanup remain unverified until the native Windows integration suite is run.
