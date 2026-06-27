import { defineAgent } from "eve";

export default defineAgent({
  // Default follows the Vercel AI Gateway model id format. Override with
  // TENDNOTE_AGENT_MODEL to compare candidate models.
  model: process.env.TENDNOTE_AGENT_MODEL ?? "anthropic/claude-haiku-4.5",
  build: {
    // The @tendnote/db snapshot path pulls the `ai` SDK, whose internal dynamic
    // imports make Rolldown emit multiple chunks; eve requires one chunk per
    // authored tool. Keep `ai` external so it stays a runtime dep instead.
    externalDependencies: ["ai"],
  },
});
