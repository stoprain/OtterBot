export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(params: Record<string, unknown>): Promise<string>;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export class ToolRegistry {
  private readonly tools: Map<string, Tool> = new Map();

  register(...tools: Tool[]): this {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(
          `ToolRegistry: a tool named "${tool.name}" is already registered`
        );
      }
      this.tools.set(tool.name, tool);
    }
    return this
  }

  unregister(name: string): this {
    this.tools.delete(name);
    return this;
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  get size(): number {
    return this.tools.size;
  }

  async execute(name: string, params: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: tool "${name}" not found. Available: ${[...this.tools.keys()].join(", ")}`;
    }
    try {
      return await tool.execute(params);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

export function createTool(definition: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(params: Record<string, unknown>): Promise<string>;
}): Tool {
  return definition;
}
