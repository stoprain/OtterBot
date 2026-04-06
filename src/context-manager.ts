import type { LLMClient, Message } from "./agent-loop";

// ─────────────────────────────────────────────────────────────────────────────
// Token estimation
//
// We don't have access to a tokenizer here, so we approximate.
// A common rule-of-thumb: 1 token ≈ 4 characters for English text.
// ─────────────────────────────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: Message): number {
  let chars = (msg.content ?? "").length;
  if (msg.tool_calls) {
    chars += JSON.stringify(msg.tool_calls).length;
  }
  return estimateTokens(chars.toString()) + 4; // +4 for role overhead
}

// ─────────────────────────────────────────────────────────────────────────────
// ContextManager
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextManagerOptions {
  maxTokens?: number;
  recentWindowSize?: number;
  summarizer?: LLMClient;
}

export class ContextManager {
  private messages: Array<Message & { pinned?: boolean }> = [];

  private readonly maxTokens: number;
  private readonly recentWindowSize: number;
  private readonly summarizer?: LLMClient;

  constructor(options: ContextManagerOptions = {}) {
    this.maxTokens = options.maxTokens ?? 100_000;
    this.recentWindowSize = options.recentWindowSize ?? 10;
    this.summarizer = options.summarizer;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Add a system prompt. Should be called once at the start.
   * System messages are always pinned.
   */
  setSystem(content: string): void {
    // Remove any existing system message before adding a new one.
    this.messages = this.messages.filter((m) => m.role !== "system");
    this.messages.unshift({ role: "system", content, pinned: true });
  }

  /**
   * Add a user message.
   * The first user message (the task) is automatically pinned.
   */
  addUser(content: string, pin = false): void {
    const isFirstUserMessage =
      !this.messages.some((m) => m.role === "user");
    this.messages.push({
      role: "user",
      content,
      pinned: pin || isFirstUserMessage,
    });
  }

  /** Add an assistant message (may include tool_calls). */
  addAssistant(message: Message): void {
    this.messages.push({ ...message, pinned: false });
  }

  addToolResult(toolCallId: string, content: string): void {
    this.messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content,
      pinned: false,
    });
  }

  /**
   * Pin a message so it is never evicted.
   * The LLM will always see pinned messages regardless of context size.
   */
  pin(index: number): void {
    const msg = this.messages[index];
    if (msg) (msg as Message & { pinned?: boolean }).pinned = true;
  }

  /** Return the current message list for passing to the LLM. */
  getMessages(): Message[] {
    return this.messages.map(({ pinned: _pinned, ...msg }) => msg);
  }

  /** Estimated total tokens in the current context. */
  get estimatedTokens(): number {
    return this.messages.reduce(
      (sum, m) => sum + estimateMessageTokens(m),
      0
    );
  }

  /** How many messages are in the context. */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Trim the context to stay within maxTokens.
   *
   * Algorithm:
   *  1. Identify pinned messages — these are never removed.
   *  2. Identify the "recent window" of the last N messages — also protected.
   *  3. Evict the oldest non-protected messages until under the limit.
   *  4. (Optional) Summarise evicted messages and inject as a user message.
   */
  async trim(): Promise<void> {
    if (this.estimatedTokens <= this.maxTokens) return;

    // Find the indices of messages we MUST keep.
    const n = this.messages.length;
    const recentStart = Math.max(0, n - this.recentWindowSize);

    const evictable: number[] = [];
    for (let i = 0; i < n; i++) {
      const msg = this.messages[i]!;
      const isRecent = i >= recentStart;
      if (!msg.pinned && !isRecent) {
        evictable.push(i);
      }
    }

    if (evictable.length === 0) {
      // Nothing we can evict — just warn and return.
      console.warn(
        `[ContextManager] Context (${this.estimatedTokens} tokens) exceeds limit ` +
        `(${this.maxTokens}) but no messages can be evicted. Consider increasing maxTokens.`
      );
      return;
    }

    // Optionally summarise messages we are about to evict.
    if (this.summarizer && evictable.length > 0) {
      const toSummarise = evictable.map((i) => this.messages[i]!);
      const summary = await this.summariseMessages(toSummarise);
      // We'll inject the summary after removing the evicted messages.
      this.removeIndices(evictable);
      // Find where to insert: right after the system prompt.
      const insertAt = this.messages.findIndex((m) => m.role !== "system") ?? 1;
      this.messages.splice(insertAt, 0, {
        role: "user",
        content: `[Context summary — earlier conversation]\n${summary}`,
        pinned: true,
      });
    } else {
      this.removeIndices(evictable);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private removeIndices(indices: number[]): void {
    // Remove in reverse order to preserve earlier indices.
    const sorted = [...indices].sort((a, b) => b - a);
    for (const i of sorted) {
      this.messages.splice(i, 1);
    }
  }

  private async summariseMessages(messages: Message[]): Promise<string> {
    if (!this.summarizer) return "";

    const text = messages
      .map((m) => `[${m.role}]: ${m.content ?? "(tool call)"}`)
      .join("\n");

    const response = await this.summarizer.chat(
      [
        {
          role: "system",
          content: "You are a concise summariser. Summarise the following conversation excerpt into 3-5 bullet points, preserving all important technical details.",
        },
        { role: "user", content: text },
      ],
      []
    );

    return response.content ?? "(summary unavailable)";
  }
}