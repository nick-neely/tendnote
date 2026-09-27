import { withIsolatedSideWrite } from "../client";
import { createDrizzleActivationMilestoneStore } from "./activation-milestones/drizzle-store";
import { createActivationMilestoneQueries } from "./activation-milestones/queries";
import type { FirstValueStep } from "./activation-milestones/types";

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
    // Inside the owner's transaction the stamp runs in a savepoint, so a failed
    // insert rolls back alone instead of aborting the owner's write.
    await withIsolatedSideWrite(() =>
      defaultActivationMilestoneQueries.recordActivationMilestone(input),
    );
  } catch (error) {
    console.warn("activation-milestones: could not record a milestone", {
      milestone: input.milestone,
      error,
    });
  }
}
