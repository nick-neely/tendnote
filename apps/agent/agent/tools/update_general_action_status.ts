import type {
  GeneralActionWithContext,
  MutationOutcome,
} from "@tendnote/db/queries/general-actions";
import {
  archiveGeneralAction,
  completeGeneralAction,
  deferGeneralAction,
  dismissGeneralAction,
  pauseGeneralAction,
  reopenGeneralAction,
  resumeGeneralAction,
} from "@tendnote/db/queries/general-actions";
import { GeneralActionValidationError } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnerApproval } from "../lib/approval";
import { describeRegisteredSubject } from "../lib/approval/subject-registry";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * `deferUntil` belongs to exactly one transition, enforced at parse time.
 *
 * The pairing used to live only in the executor, so the model learned it from a
 * thrown error after the call rather than from the schema before it - and the
 * *other* half was not checked at all: `{action:"complete", deferUntil:"…"}`
 * parsed, ignored the date, and completed the action. A user saying "push this
 * to Friday" and getting it marked done is the worst outcome this tool has, so
 * both halves are refused here, where the message can name the field to fix.
 *
 * A discriminated union would express this in the schema's *shape*, and was the
 * first choice. It is not used because eve hands the tool's JSON Schema straight
 * to the provider, and zod renders a top-level union as a root `oneOf` with no
 * `"type": "object"` - which is not a tool input schema the Messages API accepts.
 * The constraint therefore rides on a refinement over a plain object, which is
 * the same guarantee (invalid input never reaches `execute`) in a shape every
 * provider takes.
 */
const inputSchema = z
  .object({
    generalActionId: z
      .uuid()
      .describe(
        "The exact persisted action id to update - resolve it deterministically first with list_general_actions or search. Never guess; if more than one action could match the user's words, ask which one instead of calling this.",
      ),
    action: z
      .enum(["complete", "defer", "dismiss", "reopen", "archive", "pause", "resume"])
      .describe(
        "The lifecycle transition to apply. 'defer' requires deferUntil and every other transition forbids it. 'pause'/'resume' apply only to Routines. Invalid transitions are rejected by the shared layer.",
      ),
    deferUntil: z
      .string()
      .optional()
      .describe(
        "Concrete resurface date as an ISO 8601 string. Required when action is 'defer', and not accepted with any other action - to move an action's due date without deferring it, use edit_general_action. Resolve relative phrases to a concrete date; ask if the timing is ambiguous.",
      ),
  })
  .superRefine((input, ctx) => {
    if (input.action === "defer" && input.deferUntil === undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "Deferring an action needs a concrete resurface date: pass deferUntil as an ISO 8601 " +
          "date. Ask the user when it should come back if the timing is ambiguous.",
        path: ["deferUntil"],
      });
      return;
    }
    if (input.action !== "defer" && input.deferUntil !== undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          `deferUntil applies only to action "defer", not "${input.action}" - this call would ` +
          `have applied "${input.action}" to the action and silently dropped the date. Use ` +
          'action "defer" to push it out, or edit_general_action to change its due date.',
        path: ["deferUntil"],
      });
    }
  });

type UpdateInput = z.infer<typeof inputSchema>;

/** Dispatches one validated transition to its shared owner-scoped lifecycle function. */
function applyTransition(
  input: UpdateInput,
  ownerUserId: string,
): Promise<MutationOutcome<GeneralActionWithContext>> {
  const { generalActionId } = input;

  switch (input.action) {
    case "complete":
      return completeGeneralAction({ actorUserId: ownerUserId, generalActionId });
    case "dismiss":
      return dismissGeneralAction({ actorUserId: ownerUserId, generalActionId });
    case "reopen":
      return reopenGeneralAction({ actorUserId: ownerUserId, generalActionId });
    case "archive":
      return archiveGeneralAction({ actorUserId: ownerUserId, generalActionId });
    case "pause":
      return pauseGeneralAction({ actorUserId: ownerUserId, generalActionId });
    case "resume":
      return resumeGeneralAction({ actorUserId: ownerUserId, generalActionId });
    case "defer": {
      // Unreachable through the tool: the schema refuses `defer` without a date before
      // `execute` runs. Kept because the executor is also the type narrowing, and a
      // silent `new Date(undefined)` here would defer the action to Invalid Date.
      if (!input.deferUntil) {
        throw new GeneralActionValidationError(
          "Deferring an action needs a concrete resurface date.",
        );
      }
      // Parsed here; the shared layer rejects anything that isn't a concrete date.
      return deferGeneralAction({
        actorUserId: ownerUserId,
        generalActionId,
        deferUntil: new Date(input.deferUntil),
      });
    }
  }
}

/**
 * Thin wrapper over the shared General Action lifecycle transitions (ADRs 0149, 0159,
 * 0165). Eve only mutates an action on the user's explicit, action-specific instruction
 * in the current turn, against a deterministically resolved id — never from its own
 * initiative, an inference, stale context, a schedule, or a bulk sweep. The shared layer
 * validates the transition, owner-scopes it, and writes actor provenance and a history
 * event, so chat behavior cannot fork from web behavior. Returns a compact reference,
 * never a raw id in prose.
 */
export default defineTool({
  approval: requireOwnerApproval({
    describe: describeRegisteredSubject(),
    reversiblePrivateWrite: true,
  }),
  description:
    "Apply one lifecycle transition to a single General Action the user explicitly names: complete, defer (to a concrete deferUntil), dismiss, reopen, archive, or pause/resume a Routine. Only call this on the user's explicit, action-specific instruction in the current turn, against an id you resolved deterministically (via list_general_actions or search) - never mutate an action on your own initiative, from an inference, from earlier context, on a schedule, or as a bulk cleanup. If the user's request could match more than one action, or asks to 'clean up' / change many at once, ask which one(s) rather than acting; each call touches exactly one action. For 'defer', pass a concrete deferUntil; ask if the timing is ambiguous. Returns the updated action reference; name it by its title, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const outcome = await withModelSafeStoreErrors(() => applyTransition(input, ownerUserId));
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return { action: toGeneralActionRef(outcome.result) };
  },
  // A status change has no card — the model confirms the transition in prose. (The
  // ledger-list and review cards render separately; a lone transition does not.)
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        updated: true,
        action: toGeneralActionModelRef(output.action),
        guidance: "Confirm the change briefly in prose (what happened to the action).",
      },
    };
  },
});
