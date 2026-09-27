import type { ActivationMilestone, ActivationMilestoneStore } from "./types";

export function createInMemoryActivationMilestoneStore(): ActivationMilestoneStore & {
  reachedAt: (userId: string, milestone: ActivationMilestone) => Date | undefined;
} {
  const stamps = new Map<string, Map<ActivationMilestone, Date>>();

  return {
    async insertIfAbsent({ userId, milestone }) {
      const reached = stamps.get(userId) ?? new Map<ActivationMilestone, Date>();
      stamps.set(userId, reached);
      if (reached.has(milestone)) return false;
      reached.set(milestone, new Date());
      return true;
    },

    async listReached({ userId }) {
      return [...(stamps.get(userId)?.keys() ?? [])];
    },

    reachedAt(userId, milestone) {
      return stamps.get(userId)?.get(milestone);
    },
  };
}
