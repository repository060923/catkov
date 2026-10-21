# catkov

Standalone **Windows 10/11 x64** local engineering MCP server. Runs with permissions of the signed-in Windows user. Node.js 20+, npm, TypeScript, Zod, and the official Model Context Protocol SDK. No WSL, macOS components, ngrok, or browser dependencies.

## Installation and launch (Windows PowerShell)

Clone the repository from its future Git remote, then run in the cloned project directory:

```powershell
# Use your actual Git remote URL when one has been configured.
git clone '<REPOSITORY_URL>' catkov
Set-Location .\catkov
node --version                    # 20 or newer
npm ci
npm run typecheck
npm test
npm run build

# Optional: default workspace to expose in runtime_context
$env:CATKOV_WORKSPACE = 'C:\Users\Public\Documents'
# Optional: default 8791, change it if occupied
$env:CATKOV_PORT = '8791'
npm start
```

The default binding is **http://127.0.0.1:8791/mcp** (local loopback only). Health is **http://127.0.0.1:8791/health**. In another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:8791/health
```

Optional `CATKOV_HOST` overrides the listen host (default `127.0.0.1`). `CATKOV_PORT` sets the port, `CATKOV_WORKSPACE` sets the default existing workspace. The workspace defaults to the runtime's current working directory. All paths are resolved at runtime; paths containing spaces and Unicode are supported. Avoid exposing the HTTP port to untrusted networks: `shell` executes code with your user permissions.

To run as a stdio MCP server instead, after building:

```powershell
npm run start:stdio
```

## Public HTTP MCP via ngrok (optional, no client authentication)

The MCP endpoint is `/mcp`; `/health` is for diagnostics. ChatGPT-compatible clients can connect to a publicly reachable HTTPS `/mcp` URL with **Authentication: None**. No bearer token or OAuth is implemented in catkov. The ngrok authtoken belongs to the **ngrok agent**, not to the MCP client; store it in the operator's private ngrok configuration, never in Git or ChatGPT.

A Windows operator can use two PowerShell terminals after `npm ci` and `npm run build`:

```powershell
# Terminal 1: local MCP
$env:CATKOV_HOST = '127.0.0.1'
$env:CATKOV_PORT = '8791'
npm start

# Terminal 2: ngrok must already be installed and connected to your account
# Reserve your own HTTPS domain in ngrok first and configure its authtoken locally.
ngrok http 8791 --url https://YOUR-RESERVED-DOMAIN.ngrok-free.dev
```

Register `https://YOUR-RESERVED-DOMAIN.ngrok-free.dev/mcp` in the MCP client and select **no authentication**. The registered domain must belong to the ngrok account whose local agent credentials are configured. Use separate startup automation on Windows if the owner wants unattended service operation.

**Security consequence:** anyone able to reach this unauthenticated endpoint can call `shell`, which executes commands with the permissions of the running user. A random ngrok hostname is not an access-control mechanism. Do not expose a machine or workspace containing sensitive information to untrusted clients.

The temporary macOS-hosted instance used for connector validation on 2026-10-21 runs on `127.0.0.1:18794` through separate user LaunchAgents (`com.local.catkov`, `com.local.catkov.ngrok`) at `https://overtame-kadence-noncoincidentally.ngrok-free.dev/mcp`. Its compiled deployment resides under `~/Library/Application Support/catkov/runtime`; canonical sources remain in the project directory. **Windows PowerShell execution does not function on this macOS host.** The Mac service is proof of the HTTP MCP connection, not a Windows-native shell validation.

## MCP tool contract

| Tool | Input | Behavior |
| --- | --- | --- |
| `runtime_context` | `{}` | Runtime identity/version, PID, Node/OS/shell, default workspace, tool inventory and capabilities |
| `workspace_context` | `{root?, target_path?}` | Resolves existing workspace, applicable hierarchical `AGENTS.md`, SHA-256 digests, runtime/project instructions separately |
| `workspace_read_text` | `{root?, path, max_bytes?}` | Reads UTF-8 text (up to 2,000,000 bytes by default), absolute path, size and SHA-256; rejects binary and invalid UTF-8 |
| `shell` | `{action, ...}` | `exec`, `start`, `poll`, `write`, `stop`; PowerShell commands and process management |

For relative file paths, `workspace_read_text` requires an explicit `root`. It also accepts a standalone absolute `path`. `shell.exec` and `shell.start` require an explicit `root` or an absolute `cwd`. `root` and `cwd` do not change the default workspace across calls.

### shell examples

```json
{"action":"exec","root":"C:\\Users\\Public\\Documents","command":"git status --short","timeout_ms":30000}
```

```json
{"action":"start","root":"C:\\Users\\Public\\Documents","command":"npm run dev"}
```

Use the returned `process_id` (UUID) for `poll`, `write` with `input` and optional `eof`, or `stop`. `exec` returns `timed_out` and `timeout_ms`; all process snapshots include stdout/stderr, exit code, status and timestamps. Output retention is bounded to the last 1,000,000 UTF-16 code units per stream; up to 128 recent finished processes are kept when pruning is necessary.

User commands are stored in temporary UTF-8 BOM PowerShell scripts (supporting large, Unicode commands); the fixed supervisor is passed as a Base64 UTF-16LE encoded command. The ProcessManager starts a Windows Job Object supervisor, places a suspended PowerShell child in a `KILL_ON_JOB_CLOSE` job before running it, and closes the job at normal completion. `stop`, timeout and runtime shutdown use Windows process-tree termination plus the job object. The first command in a new process may incur PowerShell/.NET C# compilation startup overhead. This implementation is not yet validated on physical or virtual Windows; run the native tests before production use.

## Self-development and extensions

The runtime can read this source tree, use `shell` to create/change source files, run `npm run typecheck`, `npm test`, and `npm run build`, and restart. Register added MCP tools by adding a `defineTool(...)` definition to `src/tools.ts`, registering it through `registerCoreToolDefinitions`, and rebuilding/restarting. A reconnect of the MCP client may be necessary after changing the tool inventory. There is no hot reload.

## Validation

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm start
```

`tests/mcp.test.ts` runs real HTTP /health, initialize, tools/list, and all four tool calls. `tests/workspace.test.ts` verifies SHA-256, nested AGENTS.md, Unicode paths, explicit roots and errors. `tests/windows-shell.test.ts` validates Windows PowerShell execution, standard IO, exit codes, env/cwd, start/poll/write/stop, timeouts, descendant cleanup and agent self-development on Windows. These integration tests are intentionally skipped on non-Windows platforms.

See `VERIFICATION.md` for observed test evidence and remaining platform limitations. Public ngrok transport, repository publication, and Windows auto-start/service setup are outside this project.
