import type { GeneralAction } from "@tendnote/domain";
import type { GeneralActionLifecycleDeps } from "./types";

/**
 * Builds the embed-on-write trigger shared by the active lifecycle and the review
 * lifecycle: a single function that enqueues (and, outside production, runs) a semantic
 * embedding job for a General Action, or does nothing when no scheduler is wired (the
 * default for stores/tests that do not exercise retrieval). Extracted so both seams fire
 * the same trigger the same way rather than each keeping a near-identical wrapper (ADR
 * 0150; Phase 5 #184).
 *
 * Best-effort, like the asset twin (`queries/assets/embed.ts`): the trigger runs inline
 * outside production, so an embedding provider that is down or rate-limited throws right
 * where the caller writes. `plan_suggested_general_actions` writes its whole plan in one
 * transaction, so an escaping failure there would roll back every suggested step over a
 * lost vector - and the vector is the cheap half. The job is idempotent, so the next
 * write re-enqueues it.
 */
export function makeScheduleGeneralActionEmbedding(deps: GeneralActionLifecycleDeps) {
  const schedule = deps.scheduleGeneralActionEmbedding;

  return async function scheduleActionEmbedding(
    action: Pick<GeneralAction, "id" | "ownerUserId">,
  ): Promise<void> {
    if (!schedule) {
      return;
    }

    try {
      await schedule({
        ownerUserId: action.ownerUserId,
        recordKind: "general_action",
        recordId: action.id,
      });
    } catch {
      // A lost vector costs a fuzzy hit; a thrown one would cost the user's Action.
    }
  };
}
