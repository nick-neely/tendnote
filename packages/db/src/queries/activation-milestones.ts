import { withIsolatedSideWrite } from "../client";
import { recordServerFunnelStage } from "./account-telemetry";
import { createDrizzleActivationMilestoneStore } from "./activation-milestones/drizzle-store";
import { createActivationMilestoneQueries } from "./activation-milestones/queries";
import type { FirstValueStep } from "./activation-milestones/types";

const defaultActivationMilestoneQueries = createActivationMilestoneQueries(
  createDrizzleActivationMilestoneStore(),
  // The account funnel's copy, for an enrolled account that is still collecting.
  { onStamped: ({ userId, milestone }) => recordServerFunnelStage({ userId, stage: milestone }) },
);

/**
 * Stamp an Activation Milestone at its product event (ADR 0242). It is written
 * whatever the telemetry opt-out says and holds no content; only its optional
 * account funnel copy honours the opt-out. A failure is logged
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
