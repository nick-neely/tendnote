import { beforeEach, describe, expect, it } from "vitest";
import { createHouseholdGovernanceLifecycle } from "../households/governance";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemoryHouseholdInvitationStore } from "../households/in-memory-invitation-store";
import { privatizeGiftPlansForEndedAccess } from "./departure";
import { createInMemoryGiftPlanStore } from "./in-memory-store";
import { createGiftPlanLifecycle } from "./lifecycle";

const OWNER = "user-owner";
const CO_PLANNER = "user-co-planner";
const OTHER = "user-other";

/**
 * Governance's access-ended hook, wired to the real Gift Plan sweep.
 *
 * The unit tests either side of this one prove that governance *calls* a hook
 * and that the sweep *privatizes* plans. Neither proves they are connected, and
 * the connection is the whole reason the hook exists: without it a departing
 * owner is locked out of their own plan by the audience rule, which fails closed
 * but is still wrong. This runs the two together.
 */
describe("ending household access, end to end", () => {
  let households: ReturnType<typeof createInMemoryHouseholdInvitationStore>;
  let plansStore: ReturnType<typeof createInMemoryGiftPlanStore>;
  let plans: ReturnType<typeof createGiftPlanLifecycle>;
  let governance: ReturnType<typeof createHouseholdGovernanceLifecycle>;
  let householdId: string;
  let planId: string;

  beforeEach(async () => {
    households = createInMemoryHouseholdInvitationStore({
      identities: [
        { id: OWNER, name: "Ana", email: "ana@example.com" },
        { id: CO_PLANNER, name: "Ben", email: "ben@example.com" },
        { id: OTHER, name: "Cai", email: "cai@example.com" },
      ],
    });
    plansStore = createInMemoryGiftPlanStore(households.households);
    plans = createGiftPlanLifecycle({ plans: plansStore, households: households.households });
    governance = createHouseholdGovernanceLifecycle(households, {
      onHouseholdAccessEnded: async (input) => {
        await privatizeGiftPlansForEndedAccess(plansStore, input);
      },
    });

    const household = await seedHouseholdWithMembers(households.households, {
      ownerUserId: OWNER,
      members: [
        [OWNER, "owner"],
        [CO_PLANNER, "member"],
        [OTHER, "member"],
      ],
    });
    householdId = household.id;
    const plan = await plans.createGiftPlan({
      ownerUserId: OWNER,
      subjectName: "Rowan",
      occasion: "Fortieth birthday",
      scope: "shared",
      householdId,
      selectedUserIds: [CO_PLANNER],
    });
    planId = plan.result.id;
  });

  it("keeps a departing owner's plan readable by them, and by nobody else", async () => {
    // The last Owner cannot leave, so the household is handed over first.
    await governance.offerOwnerRole({ actorUserId: OWNER, memberUserId: CO_PLANNER });
    await governance.acceptOwnerRole({ userId: CO_PLANNER });

    await governance.leaveHousehold({ userId: OWNER });

    const mine = await plans.getGiftPlan({ callerUserId: OWNER, giftPlanId: planId });
    expect(mine?.scope).toBe("private");
    expect(mine?.householdId).toBeNull();
    expect(await plans.getGiftPlan({ callerUserId: CO_PLANNER, giftPlanId: planId })).toBeNull();
  });

  it("ends a removed co-planner's access without touching the owner's plan", async () => {
    await governance.removeMember({ actorUserId: OWNER, memberUserId: CO_PLANNER });

    const mine = await plans.getGiftPlan({ callerUserId: OWNER, giftPlanId: planId });
    expect(mine?.scope).toBe("shared");
    expect(await plans.getGiftPlan({ callerUserId: CO_PLANNER, giftPlanId: planId })).toBeNull();
  });

  it("privatizes every plan when the household is dissolved", async () => {
    const theirs = await plans.createGiftPlan({
      ownerUserId: CO_PLANNER,
      subjectName: "Rowan",
      occasion: "Anniversary",
      scope: "household",
      householdId,
    });

    await governance.confirmDissolution({ ownerUserId: OWNER });

    for (const [caller, giftPlanId] of [
      [OWNER, planId],
      [CO_PLANNER, theirs.result.id],
    ] as const) {
      const plan = await plans.getGiftPlan({ callerUserId: caller, giftPlanId });
      expect(plan?.scope).toBe("private");
      expect(plan?.householdId).toBeNull();
    }
  });
});
