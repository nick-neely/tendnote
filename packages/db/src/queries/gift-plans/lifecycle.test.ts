import { GiftPlanConflictError, GiftPlanValidationError } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { privatizeGiftPlansForEndedAccess } from "./departure";
import { createInMemoryGiftPlanLifecycleStore } from "./in-memory-store";
import { createGiftPlanLifecycle } from "./lifecycle";

const OWNER = "user-owner";
const CO_PLANNER = "user-co-planner";
const OTHER_CO_PLANNER = "user-other-co-planner";
const BYSTANDER = "user-bystander";

describe("Gift Plan lifecycle", () => {
  let store: ReturnType<typeof createInMemoryGiftPlanLifecycleStore>;
  let plans: ReturnType<typeof createGiftPlanLifecycle>;
  let householdId: string;
  let planId: string;

  beforeEach(async () => {
    store = createInMemoryGiftPlanLifecycleStore();
    plans = createGiftPlanLifecycle(store);
    const household = await seedHouseholdWithMembers(store.households, {
      ownerUserId: OWNER,
      members: [
        [OWNER, "owner"],
        [CO_PLANNER, "member"],
        [OTHER_CO_PLANNER, "member"],
        [BYSTANDER, "member"],
      ],
    });
    householdId = household.id;
    const plan = await plans.createGiftPlan({
      ownerUserId: OWNER,
      subjectName: "Rowan",
      occasion: "Fortieth birthday",
      scope: "shared",
      householdId,
      selectedUserIds: [CO_PLANNER, OTHER_CO_PLANNER],
    });
    planId = plan.result.id;
  });

  describe("creation", () => {
    it("is private unless the owner deliberately widened it", async () => {
      const solo = await plans.createGiftPlan({
        ownerUserId: OWNER,
        subjectName: "Rowan",
        occasion: "Housewarming",
      });
      expect(solo.result.scope).toBe("private");
      expect(solo.result.householdId).toBeNull();
      expect(solo.result.sharedWithUserIds).toEqual([]);
    });

    it("refuses a shared plan with nobody selected", async () => {
      await expect(
        plans.createGiftPlan({
          ownerUserId: OWNER,
          subjectName: "Rowan",
          occasion: "Housewarming",
          scope: "shared",
          householdId,
          selectedUserIds: [],
        }),
      ).rejects.toBeInstanceOf(GiftPlanValidationError);
    });

    it("records the plan's own creation in its provenance", async () => {
      const detail = await plans.getGiftPlanDetail({ callerUserId: OWNER, giftPlanId: planId });
      expect(detail?.events.map((event) => event.kind)).toContain("created");
    });
  });

  describe("the owner's authority, and its limits", () => {
    it("keeps re-addressing and ending with the owner however wide the plan gets", async () => {
      await expect(
        plans.editGiftPlan({
          actorUserId: CO_PLANNER,
          giftPlanId: planId,
          edit: { occasion: "Something else" },
        }),
      ).rejects.toThrow();
      await expect(
        plans.setGiftPlanAudience({
          actorUserId: CO_PLANNER,
          giftPlanId: planId,
          scope: "household",
          householdId,
        }),
      ).rejects.toThrow();
      await expect(
        plans.setGiftPlanStatus({
          actorUserId: CO_PLANNER,
          giftPlanId: planId,
          status: "archived",
        }),
      ).rejects.toThrow();
    });

    it("gives the household's Owner no authority over another member's plan", async () => {
      const theirs = await plans.createGiftPlan({
        ownerUserId: CO_PLANNER,
        subjectName: "Rowan",
        occasion: "Birthday",
        scope: "shared",
        householdId,
        selectedUserIds: [OWNER],
      });
      await expect(
        plans.editGiftPlan({
          actorUserId: OWNER,
          giftPlanId: theirs.result.id,
          edit: { occasion: "Mine now" },
        }),
      ).rejects.toThrow();
    });

    it("lets the owner narrow, widen, and end the plan", async () => {
      const wide = await plans.setGiftPlanAudience({
        actorUserId: OWNER,
        giftPlanId: planId,
        scope: "household",
        householdId,
      });
      expect(wide.result.scope).toBe("household");
      expect(
        await plans.getGiftPlan({ callerUserId: BYSTANDER, giftPlanId: planId }),
      ).not.toBeNull();

      const celebrated = await plans.setGiftPlanStatus({
        actorUserId: OWNER,
        giftPlanId: planId,
        status: "celebrated",
      });
      expect(celebrated.result.status).toBe("celebrated");

      await plans.deleteGiftPlan({ actorUserId: OWNER, giftPlanId: planId });
      expect(await plans.getGiftPlan({ callerUserId: OWNER, giftPlanId: planId })).toBeNull();
      expect(await store.plans.listGiftIdeas({ giftPlanId: planId })).toEqual([]);
    });

    it("stops taking new ideas and claims once the plan is celebrated", async () => {
      const idea = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: planId,
        title: "Wool blanket",
      });
      await plans.setGiftPlanStatus({
        actorUserId: OWNER,
        giftPlanId: planId,
        status: "celebrated",
      });

      // Statements about a celebration still to come are refused ...
      await expect(
        plans.addGiftIdea({ actorUserId: CO_PLANNER, giftPlanId: planId, title: "Too late" }),
      ).rejects.toThrow(/marked celebrated/);
      await expect(
        plans.claimGiftIdea({ actorUserId: OTHER_CO_PLANNER, giftIdeaId: idea.result.id }),
      ).rejects.toThrow(/marked celebrated/);

      // ... while tidying up afterwards is not.
      await expect(
        plans.editGiftIdea({
          actorUserId: CO_PLANNER,
          giftIdeaId: idea.result.id,
          edit: { note: "For the record" },
        }),
      ).resolves.toBeDefined();
      await expect(
        plans.removeGiftIdea({ actorUserId: CO_PLANNER, giftIdeaId: idea.result.id }),
      ).resolves.toBeDefined();
    });

    it("lets a claim be withdrawn after the plan is celebrated", async () => {
      const idea = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: planId,
        title: "Wool blanket",
      });
      await plans.claimGiftIdea({ actorUserId: CO_PLANNER, giftIdeaId: idea.result.id });
      await plans.setGiftPlanStatus({
        actorUserId: OWNER,
        giftPlanId: planId,
        status: "celebrated",
      });

      const released = await plans.releaseGiftIdea({
        actorUserId: CO_PLANNER,
        giftIdeaId: idea.result.id,
      });
      expect(released.result.claimedByUserId).toBeNull();
    });

    it("holds contributions off an archived plan", async () => {
      await plans.setGiftPlanStatus({ actorUserId: OWNER, giftPlanId: planId, status: "archived" });
      await expect(
        plans.addGiftIdea({ actorUserId: CO_PLANNER, giftPlanId: planId, title: "Late idea" }),
      ).rejects.toThrow(/archived/i);
    });
  });

  describe("contributions", () => {
    it("lets a co-planner add and edit their own idea and nobody else's", async () => {
      const mine = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: planId,
        title: "Wool blanket",
      });
      const theirs = await plans.addGiftIdea({
        actorUserId: OTHER_CO_PLANNER,
        giftPlanId: planId,
        title: "Cast iron pan",
      });

      await expect(
        plans.editGiftIdea({
          actorUserId: CO_PLANNER,
          giftIdeaId: mine.result.id,
          edit: { note: "The grey one" },
        }),
      ).resolves.toBeDefined();
      await expect(
        plans.editGiftIdea({
          actorUserId: CO_PLANNER,
          giftIdeaId: theirs.result.id,
          edit: { title: "Not yours" },
        }),
      ).rejects.toThrow(/added an idea/);
      await expect(
        plans.removeGiftIdea({ actorUserId: OWNER, giftIdeaId: mine.result.id }),
      ).rejects.toThrow(/added an idea/);
    });

    it("keeps a departed contributor's ideas in the owner's plan, with their attribution", async () => {
      const contributed = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: planId,
        title: "Wool blanket",
      });
      await store.households.deleteHouseholdRecordSharesForMember({
        householdId,
        userId: CO_PLANNER,
      });

      const detail = await plans.getGiftPlanDetail({ callerUserId: OWNER, giftPlanId: planId });
      expect(detail?.ideas).toHaveLength(1);
      expect(detail?.ideas[0]?.contributorUserId).toBe(CO_PLANNER);
      expect(detail?.ideas[0]?.id).toBe(contributed.result.id);
      expect(await plans.getGiftPlan({ callerUserId: CO_PLANNER, giftPlanId: planId })).toBeNull();
    });

    it("counts ideas and claims from the same proved read as the plan", async () => {
      const idea = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: planId,
        title: "Wool blanket",
      });
      await plans.addGiftIdea({
        actorUserId: OTHER_CO_PLANNER,
        giftPlanId: planId,
        title: "Cast iron pan",
      });
      await plans.claimGiftIdea({ actorUserId: CO_PLANNER, giftIdeaId: idea.result.id });

      const plan = await plans.getGiftPlan({ callerUserId: OWNER, giftPlanId: planId });
      expect(plan?.ideaCount).toBe(2);
      expect(plan?.claimedIdeaCount).toBe(1);
    });
  });

  describe("self-claims", () => {
    it("is reversible, and only by the claimant", async () => {
      const idea = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: planId,
        title: "Wool blanket",
      });
      const claimed = await plans.claimGiftIdea({
        actorUserId: OTHER_CO_PLANNER,
        giftIdeaId: idea.result.id,
      });
      expect(claimed.result.claimedByUserId).toBe(OTHER_CO_PLANNER);
      expect(claimed.result.claimedAt).not.toBeNull();

      await expect(
        plans.releaseGiftIdea({ actorUserId: CO_PLANNER, giftIdeaId: idea.result.id }),
      ).rejects.toThrow(/claimed an idea/);

      const released = await plans.releaseGiftIdea({
        actorUserId: OTHER_CO_PLANNER,
        giftIdeaId: idea.result.id,
      });
      expect(released.result.claimedByUserId).toBeNull();
      expect(released.result.claimedAt).toBeNull();
    });

    it("tells a concurrent claimant who has it rather than double-claiming", async () => {
      const idea = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: planId,
        title: "Wool blanket",
      });
      await plans.claimGiftIdea({ actorUserId: CO_PLANNER, giftIdeaId: idea.result.id });

      try {
        await plans.claimGiftIdea({ actorUserId: OTHER_CO_PLANNER, giftIdeaId: idea.result.id });
        expect.unreachable("a claimed idea must not be claimable again");
      } catch (error) {
        expect(error).toBeInstanceOf(GiftPlanConflictError);
        expect((error as GiftPlanConflictError).conflict.actorUserId).toBe(CO_PLANNER);
      }
    });

    it("records the claim and its release in the plan's provenance", async () => {
      const idea = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: planId,
        title: "Wool blanket",
      });
      await plans.claimGiftIdea({ actorUserId: CO_PLANNER, giftIdeaId: idea.result.id });
      await plans.releaseGiftIdea({ actorUserId: CO_PLANNER, giftIdeaId: idea.result.id });

      const detail = await plans.getGiftPlanDetail({ callerUserId: OWNER, giftPlanId: planId });
      expect(detail?.events.map((event) => event.kind)).toEqual(
        expect.arrayContaining(["idea_claimed", "idea_released", "idea_added"]),
      );
    });
  });

  describe("optimistic concurrency", () => {
    it("refuses a stale idea edit and reports the current value and actor", async () => {
      const idea = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: planId,
        title: "Wool blanket",
      });
      const staleRevision = idea.result.revision;
      await plans.editGiftIdea({
        actorUserId: CO_PLANNER,
        giftIdeaId: idea.result.id,
        edit: { title: "Wool blanket, grey" },
      });

      try {
        await plans.editGiftIdea({
          actorUserId: CO_PLANNER,
          giftIdeaId: idea.result.id,
          edit: { title: "Wool blanket, cream" },
          expectedRevision: staleRevision,
        });
        expect.unreachable("a stale edit must not silently overwrite");
      } catch (error) {
        expect(error).toBeInstanceOf(GiftPlanConflictError);
        expect((error as GiftPlanConflictError).conflict.currentValue).toBe("Wool blanket, grey");
        expect((error as GiftPlanConflictError).conflict.actorUserId).toBe(CO_PLANNER);
      }
    });

    it("treats an absent expectation as an explicit replace", async () => {
      const idea = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: planId,
        title: "Wool blanket",
      });
      await plans.editGiftIdea({
        actorUserId: CO_PLANNER,
        giftIdeaId: idea.result.id,
        edit: { title: "First" },
      });
      await expect(
        plans.editGiftIdea({
          actorUserId: CO_PLANNER,
          giftIdeaId: idea.result.id,
          edit: { title: "Second" },
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("the owner's link to a Person", () => {
    it("never travels to a co-planner", async () => {
      const personId = "11111111-1111-4111-8111-111111111111";
      const linked = await plans.createGiftPlan({
        ownerUserId: OWNER,
        subjectName: "Rowan",
        occasion: "Birthday",
        subjectPersonId: personId,
        scope: "shared",
        householdId,
        selectedUserIds: [CO_PLANNER],
      });

      const asOwner = await plans.getGiftPlan({
        callerUserId: OWNER,
        giftPlanId: linked.result.id,
      });
      const asCoPlanner = await plans.getGiftPlan({
        callerUserId: CO_PLANNER,
        giftPlanId: linked.result.id,
      });
      expect(asOwner?.subjectPersonId).toBe(personId);
      expect(asCoPlanner?.subjectPersonId).toBeNull();
      expect(asCoPlanner?.subjectName).toBe("Rowan");
    });
  });

  describe("departure, removal, and dissolution", () => {
    it("keeps a departed owner's plan with them, as a private one", async () => {
      await privatizeGiftPlansForEndedAccess(store.plans, { householdId, userId: OWNER });

      const plan = await plans.getGiftPlan({ callerUserId: OWNER, giftPlanId: planId });
      expect(plan?.scope).toBe("private");
      expect(plan?.householdId).toBeNull();
      expect(await plans.getGiftPlan({ callerUserId: CO_PLANNER, giftPlanId: planId })).toBeNull();
    });

    it("leaves the owner's plan alone when a co-planner departs", async () => {
      await privatizeGiftPlansForEndedAccess(store.plans, { householdId, userId: CO_PLANNER });

      const plan = await plans.getGiftPlan({ callerUserId: OWNER, giftPlanId: planId });
      expect(plan?.scope).toBe("shared");
      expect(
        await plans.getGiftPlan({ callerUserId: OTHER_CO_PLANNER, giftPlanId: planId }),
      ).not.toBeNull();
    });

    it("privatizes every plan when the household dissolves", async () => {
      const theirs = await plans.createGiftPlan({
        ownerUserId: CO_PLANNER,
        subjectName: "Rowan",
        occasion: "Birthday",
        scope: "household",
        householdId,
      });

      const swept = await privatizeGiftPlansForEndedAccess(store.plans, { householdId });
      expect(swept.privatizedPlans).toBe(2);
      expect((await plans.getGiftPlan({ callerUserId: OWNER, giftPlanId: planId }))?.scope).toBe(
        "private",
      );
      expect(
        (await plans.getGiftPlan({ callerUserId: CO_PLANNER, giftPlanId: theirs.result.id }))
          ?.scope,
      ).toBe("private");
    });

    it("keeps surprise protection through a departure rather than silently widening", async () => {
      const surprised = await plans.createGiftPlan({
        ownerUserId: OWNER,
        subjectName: "Rowan",
        occasion: "Birthday",
        surpriseSubjectUserId: BYSTANDER,
        scope: "shared",
        householdId,
        selectedUserIds: [CO_PLANNER],
      });
      await privatizeGiftPlansForEndedAccess(store.plans, { householdId, userId: OWNER });

      const stored = await store.plans.getGiftPlanById({ giftPlanId: surprised.result.id });
      expect(stored?.surpriseSubjectUserId).toBe(BYSTANDER);
      expect(
        await plans.getGiftPlan({ callerUserId: BYSTANDER, giftPlanId: surprised.result.id }),
      ).toBeNull();
    });

    it("records the ending in each plan's provenance without an actor", async () => {
      await privatizeGiftPlansForEndedAccess(store.plans, { householdId });
      const events = await store.plans.listGiftPlanEvents({ giftPlanId: planId });
      const ending = events.find((event) => event.detailJson.reason === "household_access_ended");
      expect(ending?.actorUserId).toBeNull();
      expect(ending?.kind).toBe("audience_changed");
    });
  });
});
