import { reachesFirstValue } from "@tendnote/domain/activation-milestones";
import type { ActivationMilestoneStore, FirstValueStep } from "./types";

export function createActivationMilestoneQueries(store: ActivationMilestoneStore) {
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

      if (reachesFirstValue(await store.listReached({ userId: input.userId }))) {
        await store.insertIfAbsent({ userId: input.userId, milestone: "first_value_reached" });
      }
    },
  };
}
