import { reachesFirstValue } from "@tendnote/domain/activation-milestones";
import type { ActivationMilestone, ActivationMilestoneStore, FirstValueStep } from "./types";

export type ActivationMilestoneQueryOptions = {
  /**
   * Told each time a milestone is stamped, and only then, so the optional
   * account funnel copies a milestone as it happens and never backfills one.
   */
  onStamped?: (input: { userId: string; milestone: ActivationMilestone }) => Promise<void>;
};

export function createActivationMilestoneQueries(
  store: ActivationMilestoneStore,
  options: ActivationMilestoneQueryOptions = {},
) {
  const onStamped = options.onStamped ?? (async () => {});

  return {
    /**
     * Stamp a step toward First Value the first time it happens, and First
     * Value itself the first time every step has. Only steps are recorded by
     * product code; First Value is always derived, never claimed.
     *
     * Outside a transaction the derivation cannot miss: each call lists after
     * its own stamp is committed, so whichever of two racing final steps lists
     * last sees both.
     */
    async recordActivationMilestone(input: { userId: string; milestone: FirstValueStep }) {
      const stamped = await store.insertIfAbsent(input);
      if (!stamped) return;
      await onStamped(input);

      if (reachesFirstValue(await store.listReached({ userId: input.userId }))) {
        const firstValue = { userId: input.userId, milestone: "first_value_reached" as const };
        if (await store.insertIfAbsent(firstValue)) await onStamped(firstValue);
      }
    },
  };
}
