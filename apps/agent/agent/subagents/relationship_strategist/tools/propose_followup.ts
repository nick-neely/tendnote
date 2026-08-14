import { defineTool } from "eve/tools";
import { proposeFollowupTool } from "../../../lib/tools/propose-followup";

/**
 * The strategist's registration of the shared review-gated suggestion path. It is
 * the only write this subagent has, and it stays a proposal: the owner accepts a
 * review card before anything becomes an active reminder (ADR 0124).
 */
export default defineTool(
  proposeFollowupTool({
    whenToUse:
      "Use this only for a recommendation the owner's own request already covers, grounded in a specific agenda candidate you read this turn.",
    groundingHint: "a source ref on the agenda candidate the recommendation came from.",
  }),
);
