import { dismissSuggestedGeneralAction } from "@tendnote/db/queries/general-actions";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  generalActionId: z.uuid().describe("The persisted suggested action id to dismiss."),
});

/**
 * Thin wrapper over the shared dismiss: removes a suggested General Action from review
 * without promoting it, preserving history in the resolved trail (ADRs 0151, 0152,
 * 0159). Only call on the user's explicit rejection.
 */
export default defineTool({
  description:
    "Dismiss a suggested General Action the user does not want. Only call this when the user has explicitly rejected that specific suggestion. It leaves review without adding anything to the active ledger. Returns the persisted id and new status; name the action by its title, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      dismissSuggestedGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: input.generalActionId,
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const action = outcome.result;

    return {
      action: {
        id: action.id,
        title: action.title,
        status: action.status,
      },
    };
  },
  // Strip the raw id from the model's view (ids are for tool calls only); keep the title
  // and new status so the model can confirm the dismissal in prose.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        dismissed: true,
        id: output.action.id,
        title: output.action.title,
        status: output.action.status,
        guidance: "Confirm briefly in prose that the suggestion was set aside.",
      },
    };
  },
});
