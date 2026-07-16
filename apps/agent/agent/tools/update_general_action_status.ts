import type { GeneralActionWithContext } from "@tendnote/db/queries/general-actions";
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
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  generalActionId: z
    .uuid()
    .describe(
      "The exact persisted action id to update — resolve it deterministically first with list_general_actions or search. Never guess; if more than one action could match the user's words, ask which one instead of calling this.",
    ),
  action: z
    .enum(["complete", "defer", "dismiss", "reopen", "archive", "pause", "resume"])
    .describe(
      "The lifecycle transition to apply. 'defer' also requires deferUntil. 'pause'/'resume' apply only to Routines. Invalid transitions are rejected by the shared layer.",
    ),
  deferUntil: z
    .string()
    .optional()
    .describe(
      "Concrete resurface date as an ISO 8601 string, required when action is 'defer'. Resolve relative phrases to a concrete date; ask if the timing is ambiguous.",
    ),
});

type UpdateInput = z.infer<typeof inputSchema>;

/** Dispatches one validated transition to its shared owner-scoped lifecycle function. */
function applyTransition(
  input: UpdateInput,
  ownerUserId: string,
): Promise<GeneralActionWithContext> {
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
  description:
    "Apply one lifecycle transition to a single General Action the user explicitly names: complete, defer (to a concrete deferUntil), dismiss, reopen, archive, or pause/resume a Routine. Only call this on the user's explicit, action-specific instruction in the current turn, against an id you resolved deterministically (via list_general_actions or search) — never mutate an action on your own initiative, from an inference, from earlier context, on a schedule, or as a bulk cleanup. If the user's request could match more than one action, or asks to 'clean up' / change many at once, ask which one(s) rather than acting; each call touches exactly one action. For 'defer', pass a concrete deferUntil; ask if the timing is ambiguous. Returns the updated action reference; name it by its title, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const action = await withModelSafeStoreErrors(() => applyTransition(input, ownerUserId));

    return { action: toGeneralActionRef(action) };
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
