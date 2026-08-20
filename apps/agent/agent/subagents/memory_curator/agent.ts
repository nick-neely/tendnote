import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Review-only specialist for memory cleanup requests. Reads eligible owner-scoped relationship context and proposes duplicate, stale, contradictory, vague, clarification, or Source Record cleanup candidates without directly mutating durable Memories.",
  model:
    process.env.TENDNOTE_MEMORY_CURATOR_MODEL ??
    process.env.TENDNOTE_AGENT_MODEL ??
    "anthropic/claude-sonnet-5",
});
