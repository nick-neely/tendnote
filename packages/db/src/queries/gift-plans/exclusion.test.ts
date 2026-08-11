import { HouseholdRecordUnavailableError } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createGlobalRecall } from "../global-recall/queries";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemoryGiftPlanLifecycleStore } from "./in-memory-store";
import { createGiftPlanLifecycle } from "./lifecycle";

/**
 * The Surprise Subject exclusion matrix.
 *
 * ADR 0216 says the plan, its ideas, provenance, reminders, counts, source
 * references, summaries, search results, and deep links must not reach the
 * subject. This suite runs every caller the household contains against every
 * surface the seam exposes, because a suite that checks the list view is a
 * suite that will pass on the day someone adds a search.
 *
 * Two shapes of plan are checked for each. The `shared` plan is the ordinary
 * case. The `household` plan is the sharp one: its audience is every active
 * member, the subject is an active member, and the *only* thing standing between
 * them and their own surprise is the exclusion — no allow-list is involved at
 * all.
 */
describe("Surprise Subject exclusion", () => {
  const OWNER = "user-owner";
  const SUBJECT = "user-subject";
  const CO_PLANNER = "user-co-planner";
  const BYSTANDER = "user-bystander";
  const DEPARTED = "user-departed";
  const OUTSIDER = "user-outsider";

  let store: ReturnType<typeof createInMemoryGiftPlanLifecycleStore>;
  let plans: ReturnType<typeof createGiftPlanLifecycle>;
  let householdId: string;
  let sharedPlanId: string;
  let householdPlanId: string;

  beforeEach(async () => {
    store = createInMemoryGiftPlanLifecycleStore();
    plans = createGiftPlanLifecycle(store);

    const household = await seedHouseholdWithMembers(store.households, {
      ownerUserId: OWNER,
      members: [
        [OWNER, "owner"],
        [SUBJECT, "member"],
        [CO_PLANNER, "member"],
        [BYSTANDER, "member"],
        [DEPARTED, "member"],
      ],
    });
    householdId = household.id;

    const shared = await plans.createGiftPlan({
      ownerUserId: OWNER,
      subjectName: "Rowan",
      occasion: "Fortieth birthday",
      occasionOn: new Date("2026-09-14T00:00:00Z"),
      surpriseSubjectUserId: SUBJECT,
      scope: "shared",
      householdId,
      selectedUserIds: [CO_PLANNER, DEPARTED],
    });
    sharedPlanId = shared.result.id;

    const wholeHousehold = await plans.createGiftPlan({
      ownerUserId: OWNER,
      subjectName: "Rowan",
      occasion: "Anniversary dinner",
      surpriseSubjectUserId: SUBJECT,
      scope: "household",
      householdId,
    });
    householdPlanId = wholeHousehold.result.id;

    await plans.addGiftIdea({
      actorUserId: CO_PLANNER,
      giftPlanId: sharedPlanId,
      title: "Wool blanket",
    });

    await removeHouseholdMember(store.households, { householdId, userId: DEPARTED });
  });

  /**
   * Global Recall over this world, wired the way production wires it.
   *
   * Every other source is empty so the assertion is about Gift Plans alone, and
   * `searchGiftPlans` is the seam's own function rather than a stub — a stub would
   * make this a test of the test.
   */
  function recallFor(callerUserId: string) {
    return createGlobalRecall({
      searchSelfContextExact: async () => [],
      searchHouseholdContextExact: async () => [],
      searchRelationshipExact: async () => [],
      searchRelationshipRelated: async () => [],
      searchAssets: async () => ({ results: [], semanticAvailable: true }),
      searchSavedItemsExact: async () => [],
      searchSavedItemsRelated: async () => [],
      searchGiftPlans: (input) => plans.searchGiftPlans({ ...input, callerUserId }),
      listFollowups: async () => [],
      readCalendar: async () => ({ connected: false, result: null }),
    });
  }

  /**
   * Everyone who could ask, and what each of them is entitled to. `sees` is not
   * a permission label — it is the expected answer from every read surface at
   * once, which is what makes a divergence between two surfaces a failure.
   */
  const callers = [
    { name: "the plan's owner", userId: () => OWNER, seesShared: true, seesHousehold: true },
    {
      name: "a selected co-planner",
      userId: () => CO_PLANNER,
      seesShared: true,
      seesHousehold: true,
    },
    {
      name: "an unselected active member",
      userId: () => BYSTANDER,
      seesShared: false,
      seesHousehold: true,
    },
    { name: "a departed member", userId: () => DEPARTED, seesShared: false, seesHousehold: false },
    { name: "a non-member", userId: () => OUTSIDER, seesShared: false, seesHousehold: false },
    {
      name: "the Surprise Subject",
      userId: () => SUBJECT,
      seesShared: false,
      seesHousehold: false,
    },
  ] as const;

  for (const caller of callers) {
    describe(caller.name, () => {
      it("gets the plan by id only when entitled to", async () => {
        expect(
          await plans.getGiftPlan({ callerUserId: caller.userId(), giftPlanId: sharedPlanId }),
        ).toEqual(caller.seesShared ? expect.objectContaining({ id: sharedPlanId }) : null);
        expect(
          await plans.getGiftPlan({ callerUserId: caller.userId(), giftPlanId: householdPlanId }),
        ).toEqual(caller.seesHousehold ? expect.objectContaining({ id: householdPlanId }) : null);
      });

      it("gets the ideas and provenance only when entitled to", async () => {
        const detail = await plans.getGiftPlanDetail({
          callerUserId: caller.userId(),
          giftPlanId: sharedPlanId,
        });
        if (!caller.seesShared) {
          expect(detail).toBeNull();
          return;
        }
        expect(detail?.ideas.map((idea) => idea.title)).toEqual(["Wool blanket"]);
        expect(detail?.events.length).toBeGreaterThan(0);
      });

      it("lists exactly the plans it may see, with no gap where the others were", async () => {
        const listed = await plans.listGiftPlans({ callerUserId: caller.userId() });
        const expected = [
          ...(caller.seesShared ? [sharedPlanId] : []),
          ...(caller.seesHousehold ? [householdPlanId] : []),
        ];
        expect(new Set(listed.map((plan) => plan.id))).toEqual(new Set(expected));
      });

      it("finds in search exactly what it may see", async () => {
        const found = await plans.searchGiftPlans({
          callerUserId: caller.userId(),
          query: "Rowan",
        });
        expect(found).toHaveLength((caller.seesShared ? 1 : 0) + (caller.seesHousehold ? 1 : 0));
      });

      it("recalls in Search exactly what it may see, and nothing that says more exists", async () => {
        // Global Recall is the surface #390 added, and it is an adapter rather
        // than a query: it calls the same proved search the list and the count
        // do, so it cannot come to a different answer about who may see a plan.
        // A Surprise Subject searching their own surprise gets an empty result
        // set and no limitation, hint, or "some results hidden" line to read.
        const { results, limitations } = await recallFor(caller.userId()).search({
          ownerUserId: caller.userId(),
          query: "Rowan",
          family: "gift_plans",
        });

        expect(results).toHaveLength((caller.seesShared ? 1 : 0) + (caller.seesHousehold ? 1 : 0));
        for (const result of results) {
          expect(result.family).toBe("gift_plan");
          expect(result.href).toContain("/gift-plans/");
        }
        expect(limitations).toEqual([]);
      });

      it("counts only what it may see", async () => {
        expect(await plans.countGiftPlans({ callerUserId: caller.userId() })).toBe(
          (caller.seesShared ? 1 : 0) + (caller.seesHousehold ? 1 : 0),
        );
      });

      it("may contribute only to a plan it may see", async () => {
        const contribute = plans.addGiftIdea({
          actorUserId: caller.userId(),
          giftPlanId: sharedPlanId,
          title: "Cast iron pan",
        });
        if (caller.seesShared) {
          await expect(contribute).resolves.toBeDefined();
        } else {
          await expect(contribute).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
        }
      });
    });
  }

  /**
   * The exclusion runs ahead of every other gate, which is what makes it
   * authoritative rather than one condition among several.
   */
  describe("the exclusion is absolute", () => {
    it("refuses the Surprise Subject even on a whole-household plan they are an active member of", async () => {
      const plan = await store.plans.getGiftPlanById({ giftPlanId: householdPlanId });
      expect(plan?.scope).toBe("household");
      const membership = await store.households.getHouseholdMembership({
        householdId,
        userId: SUBJECT,
      });
      expect(membership?.status).toBe("active");

      expect(
        await plans.getGiftPlan({ callerUserId: SUBJECT, giftPlanId: householdPlanId }),
      ).toBeNull();
    });

    it("keeps the protected plan out of the store's own candidate rows, not only the proof", async () => {
      // Defence in depth: the pre-filter must refuse to emit the row too, so a
      // future surface that forgets to prove still cannot leak it.
      const candidates = await store.plans.listGiftPlanCandidates({ callerUserId: SUBJECT });
      expect(candidates).toEqual([]);
    });

    it("refuses every write the subject could attempt", async () => {
      const idea = await plans.addGiftIdea({
        actorUserId: CO_PLANNER,
        giftPlanId: householdPlanId,
        title: "Framed print",
      });

      await expect(
        plans.editGiftPlan({
          actorUserId: SUBJECT,
          giftPlanId: householdPlanId,
          edit: { occasion: "Nothing to see" },
        }),
      ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
      await expect(
        plans.setGiftPlanStatus({
          actorUserId: SUBJECT,
          giftPlanId: householdPlanId,
          status: "archived",
        }),
      ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
      await expect(
        plans.deleteGiftPlan({ actorUserId: SUBJECT, giftPlanId: householdPlanId }),
      ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
      await expect(
        plans.claimGiftIdea({ actorUserId: SUBJECT, giftIdeaId: idea.result.id }),
      ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    });

    it("tells the subject the same thing a stranger is told", async () => {
      const asSubject = await plans
        .editGiftPlan({
          actorUserId: SUBJECT,
          giftPlanId: householdPlanId,
          edit: { occasion: "x" },
        })
        .catch((error: Error) => error.message);
      const asOutsider = await plans
        .editGiftPlan({
          actorUserId: OUTSIDER,
          giftPlanId: householdPlanId,
          edit: { occasion: "x" },
        })
        .catch((error: Error) => error.message);
      const asMissing = await plans
        .editGiftPlan({
          actorUserId: OWNER,
          giftPlanId: "00000000-0000-4000-8000-000000000000",
          edit: { occasion: "x" },
        })
        .catch((error: Error) => error.message);

      expect(asSubject).toBe(asOutsider);
      expect(asSubject).toBe(asMissing);
    });

    it("refuses the subject even when they are the record's owner, rather than letting ownership win", async () => {
      // An owner naming themselves is a domain mistake the product prevents; if
      // one ever reaches storage, locking out is the direction that must hold.
      const plan = await plans.createGiftPlan({
        ownerUserId: BYSTANDER,
        subjectName: "Themselves",
        occasion: "Birthday",
      });
      await store.plans.updateGiftPlan({
        giftPlanId: plan.result.id,
        patch: { surpriseSubjectUserId: BYSTANDER },
      });

      expect(
        await plans.getGiftPlan({ callerUserId: BYSTANDER, giftPlanId: plan.result.id }),
      ).toBeNull();
    });
  });

  describe("the audience can never come to include the subject", () => {
    it("refuses to select them as a co-planner", async () => {
      await expect(
        plans.setGiftPlanAudience({
          actorUserId: OWNER,
          giftPlanId: sharedPlanId,
          scope: "shared",
          householdId,
          selectedUserIds: [CO_PLANNER, SUBJECT],
        }),
      ).rejects.toThrow(/surprise/i);
    });

    it("refuses to create a plan that shares with its own subject", async () => {
      await expect(
        plans.createGiftPlan({
          ownerUserId: OWNER,
          subjectName: "Rowan",
          occasion: "Housewarming",
          surpriseSubjectUserId: SUBJECT,
          scope: "shared",
          householdId,
          selectedUserIds: [SUBJECT],
        }),
      ).rejects.toThrow(/surprise/i);
    });

    it("revokes a share the subject already held when protection is applied", async () => {
      const open = await plans.createGiftPlan({
        ownerUserId: OWNER,
        subjectName: "Rowan",
        occasion: "Retirement",
        scope: "shared",
        householdId,
        selectedUserIds: [CO_PLANNER, SUBJECT],
      });
      expect(
        await plans.getGiftPlan({ callerUserId: SUBJECT, giftPlanId: open.result.id }),
      ).not.toBeNull();

      await plans.setGiftPlanSurpriseSubject({
        actorUserId: OWNER,
        giftPlanId: open.result.id,
        surpriseSubjectUserId: SUBJECT,
      });

      expect(
        await plans.getGiftPlan({ callerUserId: SUBJECT, giftPlanId: open.result.id }),
      ).toBeNull();
      const shares = await store.households.listHouseholdRecordShares({
        householdId,
        recordKind: "gift_plan",
        recordId: open.result.id,
      });
      expect(shares.map((share) => share.sharedWithUserId)).toEqual([CO_PLANNER]);
    });

    it("refuses protection for someone who is not an active member", async () => {
      await expect(
        plans.setGiftPlanSurpriseSubject({
          actorUserId: OWNER,
          giftPlanId: sharedPlanId,
          surpriseSubjectUserId: OUTSIDER,
        }),
      ).rejects.toThrow(/active member/);
    });

    it("refuses protection on a plan that is not in a household", async () => {
      const solo = await plans.createGiftPlan({
        ownerUserId: OWNER,
        subjectName: "Rowan",
        occasion: "Just because",
      });
      await expect(
        plans.setGiftPlanSurpriseSubject({
          actorUserId: OWNER,
          giftPlanId: solo.result.id,
          surpriseSubjectUserId: SUBJECT,
        }),
      ).rejects.toThrow(/household/i);
    });
  });

  /**
   * Cache reconciliation is part of the exclusion, not an optimization beside
   * it: a page that keeps rendering what it rendered a moment ago is a surface
   * the subject can still see the plan on (ADR 0219).
   */
  describe("deferred delivery", () => {
    it("names the subject's own view as needing reconciliation when protection is applied", async () => {
      const open = await plans.createGiftPlan({
        ownerUserId: OWNER,
        subjectName: "Rowan",
        occasion: "Graduation",
        scope: "shared",
        householdId,
        selectedUserIds: [CO_PLANNER, SUBJECT],
      });
      const protectedPlan = await plans.setGiftPlanSurpriseSubject({
        actorUserId: OWNER,
        giftPlanId: open.result.id,
        surpriseSubjectUserId: SUBJECT,
      });

      expect(protectedPlan.affectedScopes).toContainEqual({
        kind: "viewer-entity",
        entity: "gift-plan",
        entityId: open.result.id,
        viewerUserId: SUBJECT,
      });
      expect(protectedPlan.affectedScopes).toContainEqual({
        kind: "viewer-collection",
        collection: "gift-plans",
        viewerUserId: SUBJECT,
      });
    });

    it("names a dropped co-planner's view when the audience narrows", async () => {
      const narrowed = await plans.setGiftPlanAudience({
        actorUserId: OWNER,
        giftPlanId: sharedPlanId,
        scope: "shared",
        householdId,
        selectedUserIds: [BYSTANDER],
      });

      expect(narrowed.affectedScopes).toContainEqual({
        kind: "viewer-entity",
        entity: "gift-plan",
        entityId: sharedPlanId,
        viewerUserId: CO_PLANNER,
      });
      expect(
        await plans.getGiftPlan({ callerUserId: CO_PLANNER, giftPlanId: sharedPlanId }),
      ).toBeNull();
    });
  });
});
