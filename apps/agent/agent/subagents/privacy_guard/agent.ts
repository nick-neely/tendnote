import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Reviewer-only household scope privacy specialist. Reviews already-scoped Eve answers and proposed shared-context actions for leakage, confusing private/shared/household phrasing, and missing clarification without deciding access or adding context.",
  model:
    process.env.TENDNOTE_PRIVACY_GUARD_MODEL ??
    process.env.TENDNOTE_AGENT_MODEL ??
    "anthropic/claude-sonnet-5",
});
