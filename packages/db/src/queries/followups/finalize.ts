import type { Followup } from "@tendnote/domain";
import type { FollowupWithContext } from "./types";

/**
 * Completes reminder side effects before presentation-only audience hydration.
 *
 * The lifecycle write has already committed. A transient hydration failure may
 * reject the response, but it must never leave a persisted reminder stale.
 */
export async function finalizeReminderMutation<T extends { result: Followup }>(
  outcome: T,
  steps: {
    reconcile: (followup: Followup) => Promise<void>;
    hydrate: (followup: Followup) => Promise<FollowupWithContext>;
  },
) {
  await steps.reconcile(outcome.result);
  return {
    ...outcome,
    result: await steps.hydrate(outcome.result),
  };
}
