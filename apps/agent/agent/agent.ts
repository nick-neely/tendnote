import { defineAgent } from "eve";

export default defineAgent({
  model: process.env.TENDNOTE_AGENT_MODEL ?? "openai/gpt-5.4-mini",
  build: {
    // The @tendnote/db snapshot path pulls the `ai` SDK, whose internal dynamic
    // imports make Rolldown emit multiple chunks; eve requires one chunk per
    // authored tool. Keep `ai` external so it stays a runtime dep instead.
    externalDependencies: ["ai"],
  },
});
