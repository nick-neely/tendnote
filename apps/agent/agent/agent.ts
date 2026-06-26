import { defineAgent } from "eve";

export default defineAgent({
  // Trialing Claude Haiku to test whether the repeated-tool-call loop is
  // model-dependent (it matches the official eve-chat-template default). Override
  // with TENDNOTE_AGENT_MODEL to compare against e.g. openai/gpt-5.4-mini.
  model: process.env.TENDNOTE_AGENT_MODEL ?? "anthropic/claude-haiku-4.5",
  build: {
    // The @tendnote/db snapshot path pulls the `ai` SDK, whose internal dynamic
    // imports make Rolldown emit multiple chunks; eve requires one chunk per
    // authored tool. Keep `ai` external so it stays a runtime dep instead.
    externalDependencies: ["ai"],
  },
});
