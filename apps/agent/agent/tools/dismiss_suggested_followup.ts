import { dismissSuggestedFollowup } from "@tendnote/db/queries/followups";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnerApproval } from "../lib/approval";
import { describeRegisteredSubject } from "../lib/approval/subject-registry";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  followupId: z.uuid().describe("The persisted suggested follow-up id to dismiss."),
});

/**
 * Thin wrapper over the shared dismiss: removes a suggested follow-up from review
 * and reminder feeds without creating a reminder, preserving history so the same
 * suggestion is not reintroduced (PRD #42, ADR-0006). Only call on the user's
 * explicit rejection.
 */
export default defineTool({
  approval: requireOwnerApproval({ describe: describeRegisteredSubject() }),
  description:
    "Dismiss a suggested follow-up the user does not want. Only call this when the user has explicitly rejected it. It leaves review without creating any reminder. Returns the persisted id and new status; name the person, never the raw id. This call pauses for the user's approval; if they cancel, say it did not happen and do not retry it or route around it.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      dismissSuggestedFollowup({
        actorUserId: ownerUserId,
        followupId: input.followupId,
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const followup = outcome.result;

    return {
      followup: {
        id: followup.id,
        personId: followup.personId,
        status: followup.status,
      },
    };
  },
  // Strip the raw ids from the model's view (ids are for tool calls only); keep the new
  // status so the model can confirm the dismissal in prose.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        dismissed: true,
        status: output.followup.status,
        guidance: "Confirm briefly that the suggested follow-up was dismissed; name the person.",
      },
    };
  },
});
