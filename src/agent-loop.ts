import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { CopilotClient } from "./copilot-client";
import { ToolRegistry } from "./tool-registry";

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

  console.log("\n--- Now testing tool-call flow ---\n");

  const mockTool = {
    name: "get_current_time",
    description: "Returns the current UTC time as an ISO string.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async (_params: Record<string, unknown>) => {
      return new Date().toISOString();
    },
  };

  const toolResponse = await client.chat(
    [
      {
        role: "system",
        content: "You are a helpful assistant. Use the get_current_time tool to answer questions about time.",
      },
      { role: "user", content: "What time is it right now?" },
    ],
    [mockTool]
  );

  if (toolResponse.tool_calls.length > 0) {
    const call = toolResponse.tool_calls[0]!;
    console.log(`LLM decided to call tool: ${call.function.name}`);
    console.log(`Arguments: ${call.function.arguments}`);

    const result = await mockTool.execute({});
    console.log(`Tool returned: ${result}`);

    const finalResponse = await client.chat(
      [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What time is it right now?" },
        {
          role: "assistant",
          content: null,
          tool_calls: toolResponse.tool_calls,
        },
        {
          role: "tool",
          tool_call_id: call.id,
          content: result,
        },
      ],
      [mockTool]
    );

    console.log("\nFinal answer:", finalResponse.content);
  } else {
    console.log("Model answered directly (no tool call):", toolResponse.content);
  }
};

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});