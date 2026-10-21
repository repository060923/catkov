import type {
  AnyToolHandler,
  McpServer,
  ServerContext,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { RuntimeError } from './errors.js';

export interface ToolDefinition<InputSchema extends StandardSchemaWithJSON = StandardSchemaWithJSON> {
  name: string;
  description: string;
  inputSchema: InputSchema;
  handler: AnyToolHandler<InputSchema>;
  runtimeCapabilities?: readonly string[];
}

interface StoredToolDefinition {
  name: string;
  description: string;
  inputSchema: StandardSchemaWithJSON;
  handler: AnyToolHandler<StandardSchemaWithJSON>;
  runtimeCapabilities: readonly string[];
}

export function defineTool<InputSchema extends StandardSchemaWithJSON>(
  definition: ToolDefinition<InputSchema>,
): ToolDefinition<InputSchema> {
  return definition;
}

export type ToolCallObserver = (toolName: string, input: unknown, ctx: ServerContext) => void | Promise<void>;

export class ToolRegistry {
  private readonly definitions = new Map<string, StoredToolDefinition>();

  constructor(private readonly observer?: ToolCallObserver) {}

  register<InputSchema extends StandardSchemaWithJSON>(
    definition: ToolDefinition<InputSchema>,
  ): void {
    if (this.definitions.has(definition.name)) {
      throw new RuntimeError('DUPLICATE_TOOL_NAME', 'MCP tool name is already registered.', {
        tool_name: definition.name,
      });
    }

    const runtimeCapabilities = definition.runtimeCapabilities ?? [definition.name];
    const existingCapabilities = new Set(this.runtimeCapabilities());
    const duplicateCapability = runtimeCapabilities.find((capability) =>
      existingCapabilities.has(capability),
    );
    if (duplicateCapability) {
      throw new RuntimeError(
        'DUPLICATE_RUNTIME_CAPABILITY',
        'Runtime capability name is already registered.',
        { capability: duplicateCapability, tool_name: definition.name },
      );
    }

    this.definitions.set(definition.name, {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      handler: definition.handler as AnyToolHandler<StandardSchemaWithJSON>,
      runtimeCapabilities,
    });
  }

  toolNames(): string[] {
    return [...this.definitions.keys()];
  }

  runtimeCapabilities(): string[] {
    return [...this.definitions.values()].flatMap((definition) =>
      definition.runtimeCapabilities,
    );
  }

  attach(server: McpServer): void {
    for (const definition of this.definitions.values()) {
      const handler = this.observer
        ? (async (input: unknown, ctx: ServerContext) => {
            try {
              await this.observer?.(definition.name, input, ctx);
            } catch {
              // Monitoring telemetry must never block the actual tool call.
            }
            return definition.handler(input as never, ctx);
          }) as AnyToolHandler<StandardSchemaWithJSON>
        : definition.handler;
      server.registerTool(
        definition.name,
        {
          description: definition.description,
          inputSchema: definition.inputSchema,
        },
        handler,
      );
    }
  }
}
