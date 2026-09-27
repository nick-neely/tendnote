import type { ActivationMilestone } from "@tendnote/domain/activation-milestones";

export type { ActivationMilestone, FirstValueStep } from "@tendnote/domain/activation-milestones";

/** Storage seam for Activation Milestones: one row per account and milestone. */
export type ActivationMilestoneStore = {
  /** Stamp a milestone unless it is already stamped; `true` when this call stamped it. */
  insertIfAbsent(input: { userId: string; milestone: ActivationMilestone }): Promise<boolean>;
  listReached(input: { userId: string }): Promise<ActivationMilestone[]>;
};
