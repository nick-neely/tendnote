import { createDrizzleActivationMilestoneStore } from "./activation-milestones/drizzle-store";
import { createActivationMilestoneQueries } from "./activation-milestones/queries";
import type { FirstValueStep } from "./activation-milestones/types";

export { createDrizzleActivationMilestoneStore } from "./activation-milestones/drizzle-store";
export { createInMemoryActivationMilestoneStore } from "./activation-milestones/in-memory-store";
export { createActivationMilestoneQueries } from "./activation-milestones/queries";
export type * from "./activation-milestones/types";

const defaultActivationMilestoneQueries = createActivationMilestoneQueries(
  createDrizzleActivationMilestoneStore(),
);

/**
 * Stamp an Activation Milestone at its product event (ADR 0242). It is written
 * whatever the telemetry opt-out says and holds no content. A failure is logged
 * and swallowed: a missed operator timestamp must never fail the owner's write.
 */
export async function recordActivationMilestone(input: {
  userId: string;
  milestone: FirstValueStep;
}) {
  try {
    await defaultActivationMilestoneQueries.recordActivationMilestone(input);
  } catch (error) {
    console.warn("activation-milestones: could not record a milestone", {
      milestone: input.milestone,
      error,
    });
  }
}
