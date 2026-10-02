import { hostedModel } from "@tendnote/db/queries/model-calls";
import { defineAgent } from "eve";
import { eveSessionAccount } from "../../lib/eve-session-account";

export default defineAgent({
  description:
    "Reviewer-only household scope privacy specialist. Reviews already-scoped Eve answers and proposed shared-context actions for leakage, confusing private/shared/household phrasing, and missing clarification without deciding access or adding context.",
  model: hostedModel({
    modelId:
      process.env.TENDNOTE_PRIVACY_GUARD_MODEL ??
      process.env.TENDNOTE_AGENT_MODEL ??
      "google/gemini-3.7-flash",
    costCategory: "interactive",
    account: eveSessionAccount,
  }),
});
