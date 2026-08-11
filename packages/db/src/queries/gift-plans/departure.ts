import type { GiftPlanStore } from "./types";

/**
 * What a departure, removal, or dissolution does to Gift Plans.
 *
 * The rule is that the plan stays with the member who made it and immediately
 * becomes private (docs/phase-8/household-gift-ideas-and-birthday-planning.md).
 * Collaborator access, claims, and any pending reminder intent end; nothing is
 * widened, transferred, or revealed to the plan's subject because a membership
 * changed.
 *
 * This runs *because* the audience rule would otherwise strand the owner. A
 * `shared` plan requires the caller's own active membership in that household
 * before ownership is even consulted, so a departed owner is refused their own
 * plan — fail-closed, and wrong. Rewriting the scope is what keeps the plan
 * theirs.
 *
 * `userId` names the departing member and privatizes only what they owned; a
 * co-planner leaving takes their access with them and leaves the owner's plan
 * alone, its shares already revoked by the departure itself. Omitting `userId`
 * is dissolution: the whole household's plans go private at once.
 *
 * Nothing here deletes a plan or an idea. A departure ends access, not
 * ownership, and contributions keep their attribution.
 */
export async function privatizeGiftPlansForEndedAccess(
  store: GiftPlanStore,
  input: { householdId: string; userId?: string },
): Promise<{ privatizedPlans: number }> {
  const plans = await store.listGiftPlansInHousehold({
    householdId: input.householdId,
    ownerUserId: input.userId,
  });

  let privatizedPlans = 0;
  for (const plan of plans) {
    if (plan.scope === "private" && plan.householdId === null) continue;
    await store.updateGiftPlan({
      giftPlanId: plan.id,
      // Surprise protection is deliberately kept. The subject was never an
      // audience for this plan and must not become one if the owner shares it
      // again later; dropping the column here would be a silent widening at the
      // one moment nobody is looking.
      patch: { scope: "private", householdId: null },
    });
    await store.createGiftPlanEvent({
      giftPlanId: plan.id,
      kind: "audience_changed",
      actorUserId: null,
      detailJson: { scope: "private", reason: "household_access_ended" },
    });
    privatizedPlans += 1;
  }

  return { privatizedPlans };
}
