import { platform, release } from 'node:os';
import { ProcessManager } from './process-manager.js';
import { WorkspaceManager } from './workspace.js';
import { RUNTIME_NAME, RUNTIME_VERSION } from './constants.js';
import { ToolRegistry } from './tool-registry.js';
import { registerCoreToolDefinitions } from './tools.js';

export class RuntimeKernel {
  private shutdownPromise: Promise<void> | undefined;

  private constructor(
    readonly workspace: WorkspaceManager,
    readonly processes: ProcessManager,
    readonly tools: ToolRegistry,
  ) {}

  static async create(): Promise<RuntimeKernel> {
    const kernel = new RuntimeKernel(
      await WorkspaceManager.create(),
      new ProcessManager(),
      new ToolRegistry(),
    );
    registerCoreToolDefinitions(kernel.tools, kernel);
    return kernel;
  }

  context(): Record<string, unknown> {
    return {
      runtime: RUNTIME_NAME,
      version: RUNTIME_VERSION,
      pid: process.pid,
      node: process.version,
      platform: platform(),
      os_release: release(),
      workspace_root: this.workspace.currentRoot(),
      shell: 'powershell.exe',
      trust_model: 'trusted_local_user',
      sandboxed: false,
      direct_sudo_invocation: false,
      tool_inventory: this.tools.toolNames(),
      capabilities: this.tools.runtimeCapabilities(),
    };
  }

  async shutdown(): Promise<void> {
    this.shutdownPromise ??= this.processes.shutdown();
    return this.shutdownPromise;
  }
}
