import type { LLMClient } from "./agent-loop";

export type StepStatus = "pending" | "in_progress" | "done" | "failed";

export interface PlanStep {
  id: number;
  description: string;
  status: StepStatus;
  /** Key findings / output summary from executing this step. */
  result?: string;
}

export class Planner {
  private steps: PlanStep[] = [];
  private nextId = 1;

  async decompose(llm: LLMClient, task: string): Promise<PlanStep[]> {
    const response = await llm.chat(
      [
        {
          role: "system",
          content: [
            "You are an expert software engineer planning a coding task.",
            "Given a task, produce a numbered list of concrete, actionable sub-tasks.",
            "Each sub-task should be completable in 1-3 agent actions (read file, write file, run shell).",
            "Output ONLY the numbered list, nothing else.",
            "Example:",
            "1. Read package.json to understand current dependencies",
            "2. Install required npm packages",
            "3. Create src/auth/token.ts with JWT helper functions",
          ].join("\n"),
        },
        {
          role: "user",
          content: `Task: ${task}`,
        },
      ],
      [] // no tools needed for planning
    );

    const text = response.content ?? "";
    this.steps = this.parseSteps(text);
    return this.steps;
  }

  /**
   * Manually set the plan steps (useful when you have a predefined plan
   * or want to write tests without an LLM).
   */
  setSteps(descriptions: string[]): PlanStep[] {
    this.steps = descriptions.map((desc) => ({
      id: this.nextId++,
      description: desc,
      status: "pending" as StepStatus,
    }));
    return this.steps;
  }

  /** Return all steps. */
  getSteps(): PlanStep[] {
    return [...this.steps];
  }

  /** Return the next pending step, or undefined if the plan is complete. */
  getNextStep(): PlanStep | undefined {
    return this.steps.find((s) => s.status === "pending");
  }

  /** Mark a step as in_progress. */
  startStep(id: number): void {
    const step = this.findStep(id);
    step.status = "in_progress";
  }

  /** Mark a step as done and store its result. */
  completeStep(id: number, result: string): void {
    const step = this.findStep(id);
    step.status = "done";
    step.result = result;
  }

  /** Mark a step as failed and store the error. */
  failStep(id: number, error: string): void {
    const step = this.findStep(id);
    step.status = "failed";
    step.result = `FAILED: ${error}`;
  }

  /**
   * Insert new corrective steps after a given step ID.
   * Used during re-planning when a step reveals unexpected complexity.
   */
  insertStepsAfter(afterId: number, descriptions: string[]): PlanStep[] {
    const insertIdx = this.steps.findIndex((s) => s.id === afterId);
    if (insertIdx === -1) throw new Error(`Step ${afterId} not found`);

    const newSteps: PlanStep[] = descriptions.map((desc) => ({
      id: this.nextId++,
      description: desc,
      status: "pending" as StepStatus,
    }));

    this.steps.splice(insertIdx + 1, 0, ...newSteps);
    return newSteps;
  }

  /** True when all steps are done or failed. */
  get isComplete(): boolean {
    return this.steps.every((s) => s.status === "done" || s.status === "failed");
  }

  /** Return a human-readable summary of the plan (great for debugging). */
  toString(): string {
    if (this.steps.length === 0) return "(empty plan)";

    const icon: Record<StepStatus, string> = {
      pending: "⏳",
      in_progress: "🔄",
      done: "✅",
      failed: "❌",
    };

    return this.steps
      .map((s) => `${icon[s.status]} [${s.id}] ${s.description}`)
      .join("\n");
  }

  /** Build a compact context string to prepend to each agent step prompt. */
  buildContext(): string {
    const done = this.steps.filter((s) => s.status === "done");
    const next = this.getNextStep();

    if (done.length === 0) {
      return next ? `Current task: ${next.description}` : "No tasks remaining.";
    }

    const summary = done
      .map((s) => `• Step ${s.id} done: ${s.description}. Result: ${s.result ?? "ok"}`)
      .join("\n");

    return [
      "=== Completed Steps ===",
      summary,
      "",
      next ? `=== Current Step ===\n${next.description}` : "All steps complete.",
    ].join("\n");
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private findStep(id: number): PlanStep {
    const step = this.steps.find((s) => s.id === id);
    if (!step) throw new Error(`Plan step ${id} not found`);
    return step;
  }

  /**
   * Parse the LLM's numbered list output into PlanStep objects.
   * Handles formats like "1. Foo bar" or "1) Foo bar".
   */
  private parseSteps(text: string): PlanStep[] {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const steps: PlanStep[] = [];

    for (const line of lines) {
      const match = line.match(/^\d+[.)]\s+(.+)$/);
      if (match?.[1]) {
        steps.push({
          id: this.nextId++,
          description: match[1],
          status: "pending",
        });
      }
    }

    // If the LLM didn't produce a numbered list, treat the whole text as one step.
    if (steps.length === 0 && text.trim()) {
      steps.push({ id: this.nextId++, description: text.trim(), status: "pending" });
    }

    return steps;
  }
}