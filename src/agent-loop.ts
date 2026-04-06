import { Tool, ToolCall } from "./tool-registry";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface StepResult {
  step: number;
  thought: string | null;
  toolCalls: ToolCall[];
  observations: string[];
  tokenUsage: LLMResponse["usage"];
}

export interface AgentLoopOptions {
  maxSteps?: number;
  timeoutMs?: number;
  onStep?: (step: StepResult) => void;
}

export interface AgentResult {
  answer: string;
  steps: number;
  totalTokenUsage: LLMResponse["usage"];
}

export interface LLMClient {
  chat(messages: Message[], tools: Tool[]): Promise<LLMResponse>;
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

export class AgentLoop {
  private readonly llm: LLMClient;
  private readonly tools: Map<string, Tool>;
  private readonly options: Required<AgentLoopOptions>;

  constructor(
    llm: LLMClient,
    tools: Tool[],
    options: AgentLoopOptions = {}
  ) {
    this.llm = llm;

    this.tools = new Map(tools.map((t) => [t.name, t]));

    this.options = {
      maxSteps: options.maxSteps ?? 20,
      timeoutMs: options.timeoutMs ?? 60_000,
      onStep: options.onStep ?? (() => { }),
    };
  }

  /**
   * Run the agent on a task.
   *
   * @param systemPrompt 
   * @param userTask     
   * @param history   
   */
  async run(
    systemPrompt: string,
    userTask: string,
    history: Message[] = []
  ): Promise<AgentResult> {
    // ── Initialise conversation ──────────────────────────────────────────────
    // The conversation always starts with a system message, then the existing
    // history (if any), then the new user task.
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userTask },
    ];

    const toolsList = Array.from(this.tools.values());
    const totalUsage: LLMResponse["usage"] = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    const deadline = Date.now() + this.options.timeoutMs;

    // ── Main loop ────────────────────────────────────────────────────────────
    for (let step = 1; step <= this.options.maxSteps; step++) {
      // Safety: respect the wall-clock timeout.
      if (Date.now() >= deadline) {
        throw new Error(
          `Agent timed out after ${this.options.timeoutMs}ms (step ${step})`
        );
      }

      // ── THINK ────────────────────────────────────────────────────────────
      // Send the entire conversation to the LLM.  It returns either:
      //   a) A plain text answer  → we are done.
      //   b) One or more tool calls → we act on them and loop again.
      const response = await this.llm.chat(messages, toolsList);

      // Accumulate token usage for the caller.
      totalUsage.prompt_tokens += response.usage.prompt_tokens;
      totalUsage.completion_tokens += response.usage.completion_tokens;
      totalUsage.total_tokens += response.usage.total_tokens;

      // Add the assistant's response to the conversation.
      // Important: we must include the tool_calls array (even if empty) so the
      // API can match tool results to the calls that triggered them.
      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls.length > 0 ? response.tool_calls : undefined,
      });

      const stepResult: StepResult = {
        step,
        thought: response.content,
        toolCalls: response.tool_calls,
        observations: [],
        tokenUsage: response.usage,
      };

      // ── CHECK FOR FINAL ANSWER ───────────────────────────────────────────
      // If the LLM returned no tool calls, it's done — return the answer.
      if (response.tool_calls.length === 0) {
        if (!response.content) {
          throw new Error("LLM returned neither a tool call nor a text answer");
        }
        this.options.onStep(stepResult);
        return {
          answer: response.content,
          steps: step,
          totalTokenUsage: totalUsage,
        };
      }

      // ── ACT + OBSERVE ────────────────────────────────────────────────────
      // Execute every tool call the LLM requested (potentially in parallel).
      const toolResultMessages = await Promise.all(
        response.tool_calls.map((call) => this.executeToolCall(call))
      );

      stepResult.observations = toolResultMessages.map((m) => m.content ?? "");

      // Append all tool results to the conversation so the LLM can see them.
      messages.push(...toolResultMessages);

      // Notify the caller about this step.
      this.options.onStep(stepResult);
    }

    // ── SAFETY: max steps exceeded ───────────────────────────────────────────
    throw new Error(
      `Agent exceeded maxSteps (${this.options.maxSteps}) without producing a final answer`
    );
  }

  /**
   * Execute a single tool call requested by the LLM.
   * Returns a 'tool' role message that can be appended to the conversation.
   */
  private async executeToolCall(call: ToolCall): Promise<Message> {
    const tool = this.tools.get(call.function.name);

    // If the LLM hallucinated a tool name, return an error observation instead
    // of crashing — the LLM can recover by trying a different approach.
    if (!tool) {
      return {
        role: "tool",
        tool_call_id: call.id,
        content: `Error: unknown tool "${call.function.name}". Available tools: ${[...this.tools.keys()].join(", ")}`,
      };
    }

    // Parse the JSON arguments string into an object.
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      return {
        role: "tool",
        tool_call_id: call.id,
        content: `Error: could not parse arguments JSON: ${call.function.arguments}`,
      };
    }

    // Execute the tool and capture its result (or any error).
    try {
      const result = await tool.execute(params);
      return {
        role: "tool",
        tool_call_id: call.id,
        content: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        role: "tool",
        tool_call_id: call.id,
        content: `Error executing ${tool.name}: ${message}`,
      };
    }
  }
}