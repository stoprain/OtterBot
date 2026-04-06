import * as dotenv from "dotenv";
import * as path from "path";

import { ContextManager, estimateTokens } from "./context-manager";

async function main(): Promise<void> {
  const manager = new ContextManager({
    maxTokens: 500,      // tiny limit for demo purposes
    recentWindowSize: 2,
  });

  manager.setSystem("You are a helpful coding assistant.");
  manager.addUser("Please refactor src/auth.ts to use async/await.");

  // Simulate several steps of tool use
  for (let i = 1; i <= 6; i++) {
    manager.addAssistant({
      role: "assistant",
      content: null,
      tool_calls: [{
        id: `call_${i}`,
        type: "function",
        function: { name: "read_file", arguments: `{"path":"src/step${i}.ts"}` },
      }],
    });

    manager.addToolResult(
      `call_${i}`,
      `// Content of step${i}.ts\nexport function step${i}() {\n  // lots of code here...\n  return ${i};\n}\n`
    );
  }

  console.log(`Before trim: ${manager.length} messages, ~${manager.estimatedTokens} tokens`);

  // Trim is synchronous here since we have no summariser configured.
  void manager.trim().then(() => {
    console.log(`After trim:  ${manager.length} messages, ~${manager.estimatedTokens} tokens`);
    console.log("\nRemaining messages:");
    manager.getMessages().forEach((m, i) => {
      const preview = (m.content ?? JSON.stringify(m.tool_calls ?? "")).slice(0, 60);
      console.log(`  [${i}] ${m.role.padEnd(9)} ${preview}…`);
    });
  });

  console.log("\n--- Token Estimation ---");
  const examples = [
    "Hello",
    "You are a helpful coding assistant.",
    "Read the file src/main.ts and tell me what the main function does.",
  ];

  for (const text of examples) {
    console.log(`  "${text.slice(0, 40)}"  → ~${estimateTokens(text)} tokens`);
  }

  console.log("\nNote: Actual tokens depend on the model's tokenizer.");
  console.log("Use tiktoken for precise counts: https://www.npmjs.com/package/tiktoken");
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});