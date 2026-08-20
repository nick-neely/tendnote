import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Private relationship strategy specialist for broad, owner-scoped next-action ranking. Reads eligible agenda context and may create review-gated Suggested Follow-Ups, but never active reminders, Memories, Source Records, Message Drafts, or external actions.",
  model:
    process.env.TENDNOTE_RELATIONSHIP_STRATEGIST_MODEL ??
    process.env.TENDNOTE_AGENT_MODEL ??
    "anthropic/claude-sonnet-5",
});
