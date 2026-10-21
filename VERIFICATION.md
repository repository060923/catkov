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

The original ToolDefinition → ToolRegistry → MCP Server → RuntimeKernel flow and the existing Windows ProcessManager/Job Object launcher are preserved. No extra MCP tools, external runtime dependencies, ngrok configuration or public transport were added. The project is packaged for publication as repository060923/catkov.

As of 2026-10-21, the MCP server SDK was upgraded to `@modelcontextprotocol/server@2.3.1`. After upgrading, `npm audit` reported **0 vulnerabilities**, and typecheck, 5 applicable tests, and build passed (4 Windows-only tests still skipped). The default local transport listens on `127.0.0.1`.

**Scope of conclusion:** macOS contract checks and compiled-server smoke tests passed. Full Windows compatibility and process-tree cleanup remain unverified until the native Windows integration suite is run.

## Public ngrok deployment — 2026-10-21

- Dedicated macOS per-user services: `com.local.catkov` (runtime at `127.0.0.1:18794`) and `com.local.catkov.ngrok` (public tunnel); both observed running.
- Public domain: `overtame-kadence-noncoincidentally.ngrok-free.dev`, formerly used by an inactive Symphony Writer service. Canonical mapping updated in `NGROK_REGISTRY.md` outside this project.
- Live public HTTPS probes: `/health` HTTP 200 (`runtime: catkov`), MCP `initialize` (`serverInfo.name: catkov`), `tools/list` (exactly four tools), and `tools/call` for `runtime_context` (`runtime: catkov`) all **PASS**, without MCP client authentication.
- The ngrok agent uses pre-existing user-local ngrok credentials, which are not added to the project or committed to Git.
- Runtime deployment is a compiled bundle in `~/Library/Application Support/catkov/runtime` to work around macOS LaunchAgent privacy permissions on the source directory under `Documents`.
- **Not verified:** Windows-specific PowerShell execution, stdin and process-tree/Job Object cleanup on native Windows. This macOS deployment does not provide functional PowerShell execution via `shell`.
- **Security:** `/mcp` has no client authorization by explicit user choice. An untrusted party reaching the public domain can invoke tools; this is unsafe when `shell` is functional on a Windows host.
