import * as readline from "readline";
import { CodingAgent } from "./agent";

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  let task = process.env["TASK"];
  if (!task) {
    // If running interactively (tty), prompt the user.
    if (process.stdin.isTTY) {
      task = await promptUser(
        "Enter your coding task (or press Enter for the demo task):\n> "
      );
    }

    // Default demo task — safe to run without modifying any real files.
    if (!task) {
      task =
        "Explore the src/tools directory structure, " +
        "then write a brief summary of what each tool does.";
    }
  }

  const usePlanner = process.env["USE_PLANNER"] !== "false";

  const agent = new CodingAgent({
    usePlanner,
    maxStepsPerTask: 15,
  });

  const start = Date.now();

  try {
    const result = await agent.run(task);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log("\n" + "═".repeat(60));
    console.log("🎉 FINAL ANSWER");
    console.log("═".repeat(60));
    console.log(result.answer);
    console.log("\n" + "─".repeat(60));
    console.log(
      `📊 Stats: ${result.planSteps} plan steps | ` +
      `${result.totalSteps} agent steps | ` +
      `~${result.totalTokens.toLocaleString()} tokens | ` +
      `${elapsed}s`
    );
  } catch (err) {
    console.error("\n❌ Agent failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main()