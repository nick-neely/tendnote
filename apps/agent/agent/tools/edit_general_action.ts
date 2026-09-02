import { editGeneralAction } from "@tendnote/db/queries/general-actions";
import { generalActionLinkSchema, generalActionRecurrenceSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnerApproval } from "../lib/approval";
import { describeRegisteredSubject } from "../lib/approval/subject-registry";
import {
  assertCurrentTurnAuthorizesGeneralActionEdit,
  currentAuthenticatedTurnMessage,
} from "../lib/current-turn-message";
import { buildGeneralActionEdit } from "../lib/general-action-edit";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  generalActionId: z
    .uuid()
    .describe(
      "The exact persisted action id to edit — resolve it deterministically first with list_general_actions or search. Never guess; ask if more than one action could match.",
    ),
  title: z.string().min(1).optional().describe("New title. Omit to leave the title unchanged."),
  notes: z
    .string()
    .nullable()
    .optional()
    .describe("New notes; pass null to clear notes, omit to leave unchanged."),
  dueAt: z
    .string()
    .nullable()
    .optional()
    .describe(
      "New concrete due date as an ISO 8601 string; pass null to make it unscheduled, omit to leave unchanged. Resolve relative phrases first; ask if ambiguous.",
    ),
  recurrence: generalActionRecurrenceSchema
    .nullable()
    .optional()
    .describe(
      "New simple cadence to make this a Routine (e.g. {interval: 6, unit: 'month'}); pass null to make it one-time again, omit to leave unchanged.",
    ),
  areaId: z
    .uuid()
    .nullable()
    .optional()
    .describe(
      "New Area to file under, taken from list_general_action_areas (or from an action's own `area` in list_general_actions) — never an invented id. Pass null to unfile, omit to leave unchanged.",
    ),
  links: z
    .array(generalActionLinkSchema)
    .optional()
    .describe("Replacement set of reference links; omit to leave links unchanged."),
});

/**
 * Thin wrapper over the shared owner-scoped General Action content edit (ADRs 0159,
 * 0165). Eve edits an action's content (title, notes, due date, cadence, Area, links)
 * only on the user's explicit, action-specific instruction in the current turn, against
 * a deterministically resolved id — never re-authoring an action on its own initiative
 * or from stale context. Editing is owner-only and rejected on terminal actions by the
 * shared layer. Returns a compact reference, never a raw id in prose.
 */
export default defineTool({
  approval: requireOwnerApproval({ describe: describeRegisteredSubject() }),
  description:
    "Edit a single General Action's content — its title, notes, due date, cadence (making it a Routine or one-time), Area, or links. Only call this on the user's explicit, action-specific instruction in the current turn, against an id you resolved deterministically; never re-author an action on your own initiative or from earlier context, and never batch-edit many at once. Pass only the fields to change: omit a field to leave it, or pass null to clear notes/due date/Area or to make a Routine one-time again. Ask which action if the request could match more than one. Returns the updated action reference; name it by its title, never the raw id. This call pauses for the user's approval; if they cancel, say it did not happen and do not retry it or route around it.",
  inputSchema,
  async execute(input, ctx) {
    const turnId = ctx.session.turn.id;
    const authorization = assertCurrentTurnAuthorizesGeneralActionEdit({
      message: currentAuthenticatedTurnMessage(turnId),
    });
    if (!authorization.authorized) {
      return {
        updated: false as const,
        authorization: "rejected" as const,
        guidance: authorization.guidance,
      };
    }
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      editGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: input.generalActionId,
        edit: buildGeneralActionEdit(input),
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return { updated: true as const, action: toGeneralActionRef(outcome.result) };
  },
  // A content edit has no card of its own — the model confirms what changed in prose.
  toModelOutput(output) {
    if (output.updated === false) {
      return {
        type: "json" as const,
        value: output,
      };
    }
    return {
      type: "json" as const,
      value: {
        updated: true,
        action: toGeneralActionModelRef(output.action),
        guidance: "Confirm briefly in prose what you changed about the action.",
      },
    };
  },
});
