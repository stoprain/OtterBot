import { Tool } from "./tool-registry";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  role: MessageRole;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface LLMResponse {
  content: string | null;
  tool_calls: ToolCall[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ApiMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface ApiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ApiResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface CopilotClientOptions {
  token?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;
}

export interface LLMClient {
  chat(messages: Message[], tools: Tool[]): Promise<LLMResponse>;
}

export class CopilotClient implements LLMClient {
  private readonly token: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly baseUrl: string;

  constructor(options: CopilotClientOptions = {}) {
    const token = options.token ?? process.env["GITHUB_TOKEN"];
    if (!token) {
      throw new Error(
        "GitHub token is required. Set GITHUB_TOKEN env var or pass token in options."
      );
    }
    this.token = token;
    this.model = options.model ?? process.env["COPILOT_MODEL"] ?? "gpt-4o";
    this.maxTokens = options.maxTokens ?? Number(process.env["MAX_TOKENS"] ?? "4096");
    this.temperature = options.temperature ?? 0;
    this.baseUrl = options.baseUrl ?? "https://models.inference.ai.azure.com";
  }

  async chat(messages: Message[], tools: Tool[]): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const apiMessages: ApiMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    }));

    const apiTools: ApiTool[] = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const body = {
      model: this.model,
      messages: apiMessages,
      ...(apiTools.length > 0
        ? { tools: apiTools, tool_choice: "auto" }
        : {}),
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    };

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          "Copilot-Integration-Id": "vscode-chat",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Network error calling Copilot API: ${String(err)}`);
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `Copilot API error ${resp.status} ${resp.statusText}: ${text}`
      );
    }

    const data = (await resp.json()) as ApiResponse;

    const choice = data.choices[0];
    if (!choice) {
      throw new Error("Copilot API returned no choices");
    }

    const msg = choice.message;

    return {
      content: msg.content ?? null,
      tool_calls: (msg.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
      usage: {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
      },
    };
  }
}