import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { CopilotClient } from "./copilot-client";

async function main(): Promise<void> {
  const client = new CopilotClient({
    model: "gpt-4o",
    temperature: 0,
  });

  console.log("Sending a simple question to GitHub Copilot...\n");

  const response = await client.chat(
    [
      {
        role: "system",
        content: "You are a concise coding assistant. Answer in 2-3 sentences.",
      },
      {
        role: "user",
        content: "What is the difference between a coding agent and a regular LLM chatbot?",
      },
    ],
    []
  );

  console.log("Answer:");
  console.log(response.content);
  console.log();
  console.log("Token usage:", response.usage);
};

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});