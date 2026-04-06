import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { AgentLoop } from "./agent-loop";
import { CopilotClient } from "./copilot-client";
import { ToolRegistry } from "./tool-registry";
import { readFileTool } from "./tools/read-file";
import { ContextManager } from "./context-manager";
import { Planner } from "./planner";

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — the agent's persona and behavioural rules
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert software engineer and coding assistant.

You can use the following tools:
- read_file: Read the contents of any file
- write_file: Create or update a file
- run_shell: Execute shell commands (npm, git, tsc, etc.)
- search_code: Search for patterns in source code files

Guidelines:
1. Always read a file before modifying it — understand before acting.
2. Make incremental changes — one logical unit at a time.
3. After modifying code, run the relevant tests or build command to verify.
4. If a command fails, read the error carefully before retrying.
5. When you have completed the task, give a concise summary of what you changed and why.

Be methodical, precise, and efficient.`;

export interface CodingAgentOptions {
  token?: string | undefined;
  usePlanner?: boolean;
  maxStepsPerTask?: number;
  maxContextTokens?: number;
  onStep?: (info: { step: number; thought: string | null; toolCalls: string[] }) => void;
}

export interface AgentRunResult {
  answer: string;
  planSteps: number;
  totalSteps: number;
  totalTokens: number;
}

export class CodingAgent {
  private readonly llm: CopilotClient;
  private readonly registry: ToolRegistry;
  private readonly token: string | undefined;
  private readonly usePlanner: boolean;
  private readonly maxStepsPerTask: number;
  private readonly maxContextTokens: number;
  private readonly onStepCallback: (info: { step: number; thought: string | null; toolCalls: string[] }) => void;

  constructor(options: CodingAgentOptions = {}) {
    this.token = options.token;
    this.usePlanner = options.usePlanner ?? true;
    this.maxStepsPerTask = options.maxStepsPerTask ?? 15;
    this.maxContextTokens = options.maxContextTokens ?? 100_000;
    this.onStepCallback = options.onStep ?? defaultOnStep;

    this.llm = new CopilotClient({
      token: this.token,
      temperature: 0, // deterministic for coding tasks
    });

    this.registry = new ToolRegistry()
      .register(readFileTool);
  }

  async run(task: string): Promise<AgentRunResult> {
    console.log(`\n🤖 Coding Agent starting…`);
    console.log(`📋 Task: ${task}\n`);

    if (this.usePlanner) {
      return this.runWithPlanner(task);
    } else {
      return this.runDirect(task);
    }
  }

  // ── Private: run with planner ──────────────────────────────────────────────

  private async runWithPlanner(task: string): Promise<AgentRunResult> {
    const planner = new Planner();

    // ── Step 1: Decompose the task ──────────────────────────────────────────
    console.log("🧩 Decomposing task into sub-tasks…\n");
    const planSteps = await planner.decompose(this.llm, task);

    console.log("Plan:");
    console.log(planner.toString());
    console.log();

    let totalSteps = 0;
    let totalTokens = 0;
    const stepAnswers: string[] = [];

    // ── Step 2: Execute each sub-task ───────────────────────────────────────
    let current = planner.getNextStep();
    while (current) {
      console.log(`\n${"─".repeat(60)}`);
      console.log(`📌 Step ${current.id}: ${current.description}`);
      console.log(`${"─".repeat(60)}`);

      planner.startStep(current.id);

      // Build a context-enriched prompt that includes what we've done so far.
      const contextualPrompt = [
        planner.buildContext(),
        "",
        `Now work on this step: ${current.description}`,
      ].join("\n");

      try {
        const result = await this.executeStep(contextualPrompt);
        planner.completeStep(current.id, result.answer.slice(0, 200));
        stepAnswers.push(`Step ${current.id}: ${result.answer}`);
        totalSteps += result.steps;
        totalTokens += result.totalTokenUsage.total_tokens;

        console.log(`\n✅ Step ${current.id} complete`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        planner.failStep(current.id, msg);
        console.error(`\n❌ Step ${current.id} failed: ${msg}`);
        // Continue with remaining steps even if one fails.
      }

      current = planner.getNextStep();
    }

    // ── Step 3: Synthesise final answer ─────────────────────────────────────
    console.log(`\n${"═".repeat(60)}`);
    console.log("🎯 All steps complete. Generating final summary…");

    const summaryResult = await this.executeStep(
      `You have completed all steps of the following task:\n${task}\n\n` +
      `Here is what was accomplished:\n${stepAnswers.join("\n\n")}\n\n` +
      `Please provide a concise final summary of everything that was done.`
    );

    return {
      answer: summaryResult.answer,
      planSteps: planSteps.length,
      totalSteps: totalSteps + summaryResult.steps,
      totalTokens: totalTokens + summaryResult.totalTokenUsage.total_tokens,
    };
  }

  // ── Private: run without planner ──────────────────────────────────────────

  private async runDirect(task: string): Promise<AgentRunResult> {
    const result = await this.executeStep(task);
    return {
      answer: result.answer,
      planSteps: 1,
      totalSteps: result.steps,
      totalTokens: result.totalTokenUsage.total_tokens,
    };
  }

  // ── Private: execute a single step with the agent loop ───────────────────

  private async executeStep(prompt: string) {
    const contextManager = new ContextManager({
      maxTokens: this.maxContextTokens,
      recentWindowSize: 10,
    });

    // Build the agent loop for this step.
    const loop = new AgentLoop(this.llm, this.registry.list(), {
      maxSteps: this.maxStepsPerTask,
      timeoutMs: 120_000, // 2 minutes per step
      onStep: (s) => {
        this.onStepCallback({
          step: s.step,
          thought: s.thought,
          toolCalls: s.toolCalls.map((tc) => tc.function.name),
        });

        // After each step, trim the context manager.
        // (In a more integrated design, the AgentLoop would use ContextManager
        //  directly — this shows how the two components interact.)
        void contextManager.trim();
      },
    });

    return loop.run(SYSTEM_PROMPT, prompt);
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// Default step logger
// ─────────────────────────────────────────────────────────────────────────────

function defaultOnStep(info: {
  step: number;
  thought: string | null;
  toolCalls: string[];
}): void {
  const tools =
    info.toolCalls.length > 0 ? `→ [${info.toolCalls.join(", ")}]` : "→ [final answer]";

  const thought =
    info.thought
      ? `  💭 ${info.thought.slice(0, 120).replace(/\n/g, " ")}…`
      : "";

  console.log(`  Step ${info.step} ${tools}`);
  if (thought) console.log(thought);
}