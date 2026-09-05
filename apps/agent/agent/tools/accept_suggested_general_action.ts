import { acceptSuggestedGeneralAction } from "@tendnote/db/queries/general-actions";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnerApproval } from "../lib/approval";
import { describeRegisteredSubject } from "../lib/approval/subject-registry";
import { buildGeneralActionEdit } from "../lib/general-action-edit";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  generalActionId: z.uuid().describe("The persisted suggested action id to accept."),
  edit: z
    .object({
      title: z.string().min(1).optional(),
      notes: z.string().nullable().optional(),
      dueAt: z
        .string()
        .nullable()
        .optional()
        .describe("New concrete due date as an ISO 8601 string, or null to make it unscheduled."),
    })
    .optional()
    .describe(
      "Optional corrections to apply before accepting (fix the title, notes, or due date).",
    ),
});

/**
 * Thin wrapper over the shared accept: promotes a tentative suggested General Action in
 * place to a durable `open` action (a Routine when it carries a cadence), applying any
 * correction first (ADRs 0151, 0152, 0159). Only call on the user's explicit approval —
 * never accept on the user's behalf. Idempotent: re-accepting an already-promoted
 * proposal returns it unchanged.
 */
export default defineTool({
  approval: requireOwnerApproval({
    describe: describeRegisteredSubject(),
    reversiblePrivateWrite: true,
  }),
  description:
    "Accept a suggested General Action, promoting it onto the active ledger (a Routine if it carries a cadence). Only call this when the user has explicitly approved that specific suggestion - never accept on their behalf. Optionally apply corrections (title, notes, or due date) first. Returns the now-active action reference; name it by its title, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      acceptSuggestedGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: input.generalActionId,
        // The correction is a subset of the shared edit fields; map it the same way.
        edit: input.edit ? buildGeneralActionEdit(input.edit) : undefined,
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const result = outcome.result;

    return {
      component: result.component,
      action: toGeneralActionRef(result.action),
    };
  },
  // Accepting from a tool call (rather than the card's own Accept button) settles the
  // proposal without rendering a new card, so the model confirms the promotion in prose.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        accepted: true,
        action: toGeneralActionModelRef(output.action),
        guidance:
          "Confirm briefly in prose that it's now on their active list (you can mention what and, if set, when).",
      },
    };
  },
});
