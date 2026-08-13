import type { HouseholdCoordinationRecord } from "@tendnote/domain";
import { giftPlanExclusions, HOUSEHOLD_HOME_COMING_UP_DAYS } from "@tendnote/domain";
import type { GiftPlanWithContext } from "../../gift-plans/types";
import { formatDateInZone } from "../../today/candidate-loaders/shared";
import type { HouseholdHomeCandidate, HouseholdHomeCandidateLoader } from "../types";

const DAY_MS = 24 * 60 * 60 * 1_000;

export type HouseholdCheckinGiftPlanDeps = {
  /**
   * The Gift Plans this caller may currently see, from the Gift Plan seam's own
   * proved read.
   *
   * The seam narrows in SQL with the Surprise Subject clause and proves every
   * surviving row, so a protected plan never reaches this loader for the person
   * it protects against. The composition proves each candidate again anyway, on
   * facts read at that moment — the two gates are the point, not redundancy
   * (ADR 0216, ADR 0219).
   */
  listVisibleGiftPlans: (input: {
    callerUserId: string;
    limit: number;
  }) => Promise<GiftPlanWithContext[]>;
};

/** Bounded like every other family's: a shortlist reads a window, not the ledger. */
const GIFT_PLAN_WINDOW = 20;

/**
 * Gift Plans on a member's Household Check-in.
 *
 * A plan composes only when it is dated, still open, and its occasion falls
 * inside the household's ordinary horizon — the same two weeks every other
 * family uses, so the Check-in has one idea of "soon". An undated plan is not
 * timely by definition and stays on its own surface.
 *
 * It is a **planning reference, not a task**: the row carries no progress
 * control and is never pressing. A gift plan does not ask the household to do
 * something today, and dressing one as a chore would turn a birthday into a
 * deadline. A past occasion drops out entirely rather than reading as overdue —
 * a birthday that has been and gone is not work anyone failed to do.
 *
 * The scope label is the plan's own audience shape and never a member list: a
 * co-planner roster on a shortlist row would turn a private plan into a small
 * directory of who else is in on it.
 */
export async function loadHouseholdCheckinGiftPlanCandidates(
  deps: HouseholdCheckinGiftPlanDeps,
  input: Parameters<HouseholdHomeCandidateLoader>[0],
): Promise<HouseholdHomeCandidate[]> {
  const plans = await deps.listVisibleGiftPlans({
    callerUserId: input.callerUserId,
    limit: GIFT_PLAN_WINDOW,
  });

  const candidates: HouseholdHomeCandidate[] = [];
  for (const plan of plans) {
    if (plan.householdId !== input.householdId) continue;
    if (plan.status !== "active") continue;
    const at = plan.occasionOn;
    if (!at) continue;
    if (at.getTime() < input.now.getTime()) continue;
    if (at.getTime() > input.now.getTime() + HOUSEHOLD_HOME_COMING_UP_DAYS * DAY_MS) continue;

    candidates.push({
      facts: {
        kind: "gift_plan",
        id: plan.id,
        ownerUserId: plan.ownerUserId,
        scope: plan.scope,
        householdId: plan.householdId,
        ownership: "member_owned",
        // The domain's own exclusion, derived from the stored column rather than
        // accepted from anywhere. It is already enforced upstream; carrying it
        // here means the composition's proof refuses the Surprise Subject too,
        // rather than trusting that the read above did.
        excludedUserIds: giftPlanExclusions(plan),
      },
      record: checkinRecord(plan, at, input),
    });
  }
  return candidates;
}

function checkinRecord(
  plan: GiftPlanWithContext,
  at: Date,
  input: Parameters<HouseholdHomeCandidateLoader>[0],
): HouseholdCoordinationRecord {
  return {
    identity: `gift_plan:${plan.id}`,
    family: "gift_plan",
    section: "coming_up",
    pressing: false,
    record: {
      kind: "gift_plan",
      id: plan.id,
      href: `/gift-plans/${plan.id}`,
    },
    title: `${plan.subjectName} · ${plan.occasion}`,
    context: "Gift plan",
    timing: {
      code: "scheduled",
      explanation: `${plan.occasion} on ${formatDateInZone(at, input.timeZone)}.`,
    },
    // The audience shape, never who is in it. "Yours" for the owner keeps the
    // row honest about whose record it is without naming the others.
    scopeLabel: plan.ownerUserId === input.callerUserId ? "Your plan" : "Shared with you",
    responsibility: null,
    // No inline control. Adding an idea, claiming one, or ending a plan are all
    // decisions that belong on the plan itself.
    progress: null,
    at,
    createdAt: plan.createdAt,
  };
}
