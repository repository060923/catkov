# catkov

Standalone **Windows 10/11 x64** local engineering MCP server. Runs with permissions of the signed-in Windows user. Node.js 20+, npm, TypeScript, Zod, and the official Model Context Protocol SDK. No WSL, macOS components, ngrok, or browser dependencies.

## Quick setup on Windows 10/11 x64

Requirements: **Windows PowerShell**, Windows x64, Node.js 20+ and Git. These commands install the prerequisites using Windows Package Manager (if already installed, skip those lines). **Open a new PowerShell window after installing Node.js and Git** so the PATH refreshes:

```powershell
winget install --id Git.Git --exact
winget install --id OpenJS.NodeJS.LTS --exact
winget install ngrok -s msstore
```

### Terminal 1 — download, build and start catkov

```powershell
git clone https://github.com/repository060923/catkov.git
Set-Location .\catkov
npm ci
npm run build

# Choose an existing workspace folder that catkov may access, or leave unset
# to use the current project directory:
# $env:CATKOV_WORKSPACE = 'C:\Users\Public\Documents'

$env:CATKOV_HOST = '127.0.0.1'
$env:CATKOV_PORT = '8791'
npm start
```

Leave this terminal open. The MCP endpoint is `http://127.0.0.1:8791/mcp`. Open a separate PowerShell window to check it:

```powershell
Invoke-RestMethod http://127.0.0.1:8791/health
```

### Terminal 2 — public HTTPS (optional)

Each operator uses their **own ngrok account, authtoken and reserved HTTPS domain**. A domain already in use by someone else must not be reused. Do not commit the authtoken to Git or include it in the ChatGPT plugin configuration.

```powershell
# Configure once (prompts for your ngrok account authtoken without writing it into the command history):
ngrok config add-authtoken (Read-Host 'Enter your ngrok authtoken')

# Replace this placeholder with the HTTPS domain reserved in YOUR ngrok account:
ngrok http 8791 --url https://YOUR-RESERVED-DOMAIN.ngrok-free.dev
```

The ngrok console should show a forwarding URL. Check `https://YOUR-RESERVED-DOMAIN.ngrok-free.dev/health` and register **`https://YOUR-RESERVED-DOMAIN.ngrok-free.dev/mcp`** as a remote MCP server with **Authentication: None**. Keep both PowerShell windows running while using the plugin. The ngrok authtoken only authorizes the tunnel with ngrok; it is not MCP client authentication.

**Important:** this mode has **no MCP client authorization**. Anyone who can reach the public endpoint can call `shell`, which runs PowerShell with your Windows user privileges. Treat this as a trusted/private deployment only. A random ngrok domain is not security control.

### Verify the Windows implementation

From the project folder in another terminal:

```powershell
npm run typecheck
npm test
npm run build
```

The tests include native Windows PowerShell, interactive IO, timeout and process-tree termination checks. Do not treat tests run on another OS as equivalent to these native checks. For a local stdio MCP server instead of HTTP, run `npm run start:stdio` after building. Optional `CATKOV_HOST`, `CATKOV_PORT`, and `CATKOV_WORKSPACE` override the default loopback host, port (`8791`), and workspace (current directory).

The initial connector smoke-test on 2026-10-21 used macOS LaunchAgents with `overtame-kadence-noncoincidentally.ngrok-free.dev`. This **is not a transferable domain** and is not part of the Windows install; every other operator must reserve and configure their own domain. Windows `shell` cannot execute on the macOS test host.

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

See `VERIFICATION.md` for observed test evidence and remaining platform limitations. Local HTTP is built in, ngrok is an optional externally managed tunnel, and no built-in Windows auto-start/service setup is provided.
