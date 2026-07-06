import type { GeneralAction } from "@tendnote/domain";
import type { GeneralActionLifecycleDeps } from "./types";

/**
 * Builds the embed-on-write trigger shared by the active lifecycle and the review
 * lifecycle: a single function that enqueues (and, outside production, runs) a semantic
 * embedding job for a General Action, or does nothing when no scheduler is wired (the
 * default for stores/tests that do not exercise retrieval). Extracted so both seams fire
 * the same trigger the same way rather than each keeping a near-identical wrapper (ADR
 * 0150; Phase 5 #184).
 */
export function makeScheduleGeneralActionEmbedding(deps: GeneralActionLifecycleDeps) {
  const schedule = deps.scheduleGeneralActionEmbedding;

  return async function scheduleActionEmbedding(
    action: Pick<GeneralAction, "id" | "ownerUserId">,
  ): Promise<void> {
    if (!schedule) {
      return;
    }
    await schedule({
      ownerUserId: action.ownerUserId,
      recordKind: "general_action",
      recordId: action.id,
    });
  };
}
