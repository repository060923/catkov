# catkov — agent instructions

- This is a **Windows 10/11 x64**, Node.js 20+ TypeScript MCP runtime.
- Preserve the single flow `ToolDefinition → ToolRegistry → MCP Server → RuntimeKernel`.
- Production MCP tools are exactly `runtime_context`, `workspace_context`, `workspace_read_text`, and `shell` until explicitly extended.
- ToolRegistry is the only point that registers tools. Do not introduce a second runtime, plugin framework, or scheduler.
- ProcessManager is the only process-owner. On Windows a PowerShell Job Object supervisor assigns a suspended child to a kill-on-close job, supporting cleanup of process descendants. Keep lifecycle tests aligned with Windows semantics.
- Workspace operations are explicit per call: no process-global mutation. File reads return SHA-256; relative reads require `root`.
- File creation and changes happen through `shell` (PowerShell), not a separate write tool.
- Use `npm ci`, `npm run typecheck`, `npm test`, `npm run build` and HTTP MCP checks after changes. Run actual shell integration tests on Windows; do not equate non-Windows test results with native validation.
- Do not add public transport, ngrok, WSL dependencies, Windows service startup, or bundled absolute user paths without explicit user request.
- Preserve unrelated user work and report any tests skipped or not executable.
