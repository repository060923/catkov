export const RUNTIME_NAME = 'catkov';
export const RUNTIME_VERSION = '0.1.0';

export const RUNTIME_INSTRUCTIONS = `
The active local engineering runtime is catkov, running as the current Windows user.

For engineering work, inspect the workspace, make changes using shell, run tests/builds, verify through MCP, and report real evidence. Do not claim verification that has not occurred.

Workspace selection is explicit and does not mutate the runtime default. Pass root to workspace_context, workspace_read_text, and shell. For a relative read path an explicit root is mandatory. shell exec/start require root or an absolute cwd.

Use shell for file creation, editing, Git, npm, tests and extending this runtime. New tools are registered through ToolRegistry and require a runtime restart. Preserve unrelated work. Do not assume ngrok or a public transport.
`.trim();
