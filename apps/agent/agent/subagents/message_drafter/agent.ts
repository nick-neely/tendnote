import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Review-only specialist for source-grounded message draft proposals and tone variants. It proposes ephemeral wording only; it cannot persist Tendnote drafts or create external drafts.",
  model:
    process.env.TENDNOTE_MESSAGE_DRAFTER_MODEL ??
    process.env.TENDNOTE_AGENT_MODEL ??
    "anthropic/claude-haiku-4.5",
});
