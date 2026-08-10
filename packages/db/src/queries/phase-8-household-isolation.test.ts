import { HouseholdRecordUnavailableError } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryAssetEvidenceStore } from "./assets/in-memory-evidence-store";
import { createInMemoryAssetLinkStore } from "./assets/in-memory-link-store";
import {
  createInMemoryAssetReviewStore,
  createInMemoryGeneralActionAssetLinkStore,
} from "./assets/in-memory-review-store";
import { createInMemoryAssetStore } from "./assets/in-memory-store";
import { createAssetLifecycle } from "./assets/lifecycle";
import { createAssetReview } from "./assets/review";
import { createContextFactQueries, createInMemoryContextFactStore } from "./context-facts";
import { createInMemoryGeneralActionAreaStore } from "./general-action-areas/in-memory-store";
import { createInMemoryGeneralActionStore } from "./general-actions/in-memory-store";
import { createGeneralActionLifecycle } from "./general-actions/lifecycle";
import type { GeneralActionLifecycleStore } from "./general-actions/types";
import { createInMemoryGiftPlanStore } from "./gift-plans/in-memory-store";
import { createGiftPlanLifecycle } from "./gift-plans/lifecycle";
import { createHouseholdAuthorizationProver } from "./households/authorization";
import { createHouseholdEventPlanLifecycle } from "./households/event-plans";
import { removeHouseholdMember, seedHouseholdWithMembers } from "./households/household-fixtures";
import {
  createInMemoryHouseholdEventPlanLinkTargetStore,
  createInMemoryHouseholdEventPlanStore,
} from "./households/in-memory-event-plan-store";
import { createHouseholdLifecycle } from "./households/lifecycle";
import { createHouseholdOverviewReader } from "./households/overview";
import { createInMemoryPersonReferenceStore } from "./person-references/in-memory-store";
import { createPersonReferences } from "./person-references/references";
import type { PersonReferenceHost } from "./person-references/types";
import { createInMemoryRelationshipShareStore } from "./relationship-shares/in-memory-store";
import { createRelationshipSharing } from "./relationship-shares/sharing";
import { createHouseholdSavedItemCollaboration } from "./saved-items/household-native";
import { createInMemorySavedItemLifecycleStore } from "./saved-items/in-memory-store";
import { createSavedItemLifecycle } from "./saved-items/lifecycle";

/**
 * The cross-domain proof: one household, one set of access-changing events, and
 * every record family answering them the same way.
 *
 * Each domain already proves its own contract in its own suite. What none of
 * them can prove alone is the thing Phase Eight actually promises — that a
 * removal, a departure, a dissolution, or an audience change means the same
 * thing everywhere, and that no family quietly keeps a door open because its
 * ownership happens to be represented differently from its neighbour's.
 *
 * So this suite is written as a battery rather than as prose. Every family
 * supplies the same four answers — how to make the workspace's own record, how
 * to make a member's own, how to read one, how to list them — and the battery
 * below is applied to all of them identically. Adding a family means adding a
 * case, not adding assertions, which is what keeps the matrix honest as the
 * product grows: a new family that cannot answer the battery is a new family
 * that has not decided what departure means.
 *
 * Every domain here shares ONE household store. Two would let the domains
 * disagree about who is a member, and a suite whose domains disagree about
 * membership is measuring its own fixture rather than the product.
 */
const ANA = "ana";
const BEN = "ben";
const OUTSIDER = "zoe";

/**
 * What a caller may still reach, normalized across each family's refusal shape.
 *
 * `search` is `null` for a family with no query surface, so the battery can say
 * "everything this family exposes" without pretending a surface exists. Where it
 * does exist it is asserted alongside the others, because a retrieval path that
 * ranked before it proved would be the one place a record could survive its own
 * revocation.
 */
type Reach = { detail: boolean; list: boolean; search: boolean | null };

type FamilyCase = {
  name: string;
  /** The record id under test. */
  recordId: string;
  detail: (callerUserId: string) => Promise<unknown>;
  list: (callerUserId: string) => Promise<string[]>;
  search?: (callerUserId: string) => Promise<string[]>;
};

/**
 * The families refuse in three different shapes — `null`, an empty list, and a
 * thrown {@link HouseholdRecordUnavailableError} — and all three are correct.
 * What matters is that they mean the same thing, so the battery reads them
 * through one function and asserts on the meaning rather than the shape.
 *
 * A throw that is *not* the opaque unavailable error is deliberately allowed to
 * propagate: an unexpected failure must fail the test, not be counted as a
 * successful denial.
 */
async function reach(family: FamilyCase, callerUserId: string): Promise<Reach> {
  const opaque = async (read: () => Promise<boolean>) => {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof HouseholdRecordUnavailableError)) throw error;
      return false;
    }
  };
  const includesRecord = (read: (caller: string) => Promise<string[]>) =>
    opaque(async () => (await read(callerUserId)).includes(family.recordId));

  return {
    detail: await opaque(async () => Boolean(await family.detail(callerUserId))),
    list: await includesRecord(family.list),
    search: family.search ? await includesRecord(family.search) : null,
  };
}

/** Asserts every surface a family has, without inventing one it does not. */
function gone(family: FamilyCase): Reach {
  return { detail: false, list: false, search: family.search ? false : null };
}

function there(family: FamilyCase): Reach {
  return { detail: true, list: true, search: family.search ? true : null };
}

function seedStack() {
  // The one household every domain below reads its memberships and shares from.
  const shared = createInMemorySavedItemLifecycleStore();
  const prover = createHouseholdAuthorizationProver(shared);

  const actionStore: GeneralActionLifecycleStore = {
    ...createInMemoryGeneralActionAreaStore(),
    ...createInMemoryGeneralActionStore(shared),
    getPerson: (input) => shared.getPerson(input),
    getSourceRecord: (input) => shared.getSourceRecord(input),
    getVisibleSourceRecord: (input) => shared.getVisibleSourceRecord(input),
  };

  const assetStore = createInMemoryAssetStore(shared);
  const assetLifecycleStore = {
    ...shared,
    ...assetStore,
    ...createInMemoryAssetReviewStore({
      getOwnedAsset: (input) => assetStore.getAsset(input),
      householdStore: shared,
    }),
    ...createInMemoryAssetEvidenceStore({
      getOwnedAsset: (input) => assetStore.getAsset(input),
      getVisibleAsset: (input) => assetStore.getVisibleAsset(input),
      householdStore: shared,
    }),
    ...createInMemoryGeneralActionAssetLinkStore(),
    ...createInMemoryAssetLinkStore(),
  };

  const eventPlanLinkTargets = createInMemoryHouseholdEventPlanLinkTargetStore();
  const contextFactStore = createInMemoryContextFactStore([], { householdAccess: shared });

  return {
    shared,
    household: createHouseholdLifecycle(shared),
    savedItems: createSavedItemLifecycle(shared),
    savedItemCollaboration: createHouseholdSavedItemCollaboration(shared),
    actions: createGeneralActionLifecycle(actionStore),
    assets: createAssetLifecycle(assetLifecycleStore),
    assetReview: createAssetReview(assetLifecycleStore),
    giftPlans: createGiftPlanLifecycle({
      plans: createInMemoryGiftPlanStore(shared),
      households: shared,
    }),
    eventPlans: createHouseholdEventPlanLifecycle({
      households: shared,
      plans: createInMemoryHouseholdEventPlanStore(),
      linkTargets: eventPlanLinkTargets,
      prover,
    }),
    eventPlanLinkTargets,
    // `resolveVerifiedCaller` takes no arguments, so the seam is built per caller.
    contextFactsFor: (userId: string) =>
      createContextFactQueries(contextFactStore, {
        householdAccess: shared,
        sourceRecords: { getSourceRecordById: async () => null },
        resolveVerifiedCaller: async () => userId,
      }),
    references: createPersonReferences(createInMemoryPersonReferenceStore(shared)),
  };
}

type Stack = ReturnType<typeof seedStack>;

/**
 * Every family's workspace-owned record, made by Ana.
 *
 * Three families are absent from this list and that is a fact about the product
 * rather than a gap in the suite: a Gift Plan has no household-native form (it
 * stays with the member who made it, so the Surprise Subject rule has an owner
 * to protect it from), and Event Plans and household Context Facts have no
 * member-owned form (both are the workspace's by construction). Each appears in
 * exactly the half of the matrix it can occupy.
 */
async function householdNativeFamilies(stack: Stack, householdId: string): Promise<FamilyCase[]> {
  const item = await stack.savedItemCollaboration.createHouseholdSavedItem({
    actorUserId: ANA,
    householdId,
    kind: "note",
    title: "Boiler service is due",
  });
  const action = await stack.actions.createGeneralAction({
    ownerUserId: ANA,
    title: "Put the bins out",
    ownership: "household_native",
    householdId,
  });
  const asset = await stack.assets.createAsset({
    ownerUserId: ANA,
    name: "Kitchen refrigerator",
    kind: "appliance",
    ownership: "household_native",
    householdId,
  });
  const memory = await stack.assetReview.createActiveAssetMemory({
    ownerUserId: ANA,
    assetId: asset.id,
    label: "Filter size",
    value: { type: "text", text: "EDR3RXD1" },
    ownership: "household_native",
  });
  const evidence = await stack.assetReview.addAssetEvidence({
    ownerUserId: ANA,
    assetId: asset.id,
    kind: "receipt",
    label: "Purchase receipt",
    url: "https://example.test/receipt",
    ownership: "household_native",
  });
  const plan = await stack.eventPlans.createHouseholdEventPlan({
    callerUserId: ANA,
    draft: { title: "Spring garage clear-out" },
  });
  const factOutcome = (
    await stack.contextFactsFor(ANA).createHouseholdContextFact({
      callerUserId: ANA,
      category: "preference",
      content: "Bins go out on Tuesday night.",
    })
  ).result;
  if (!("fact" in factOutcome)) throw new Error("expected the household fact to save");
  const fact = factOutcome.fact;
  const referenceHost: PersonReferenceHost = {
    kind: "general_action",
    id: action.id,
    ownerUserId: ANA,
    scope: "household",
    householdId,
    ownership: "household_native",
  };
  const reference = await stack.references.addPersonReference({
    actorUserId: ANA,
    host: referenceHost,
    label: "Dr Okafor",
  });

  return [
    {
      name: "Saved Item",
      recordId: item.id,
      detail: (caller) =>
        stack.savedItems.getSavedItem({ callerUserId: caller, savedItemId: item.id }),
      list: async (caller) =>
        (await stack.savedItems.listSavedItems({ callerUserId: caller })).map((row) => row.id),
      search: async (caller) =>
        (await stack.savedItems.searchSavedItems({ callerUserId: caller, query: "boiler" })).map(
          (row) => row.id,
        ),
    },
    {
      name: "Action",
      recordId: action.id,
      detail: (caller) =>
        stack.actions.getGeneralAction({ actorUserId: caller, generalActionId: action.id }),
      list: async (caller) =>
        (await stack.actions.listActiveGeneralActions({ ownerUserId: caller })).map(
          (row) => row.id,
        ),
    },
    {
      name: "Asset",
      recordId: asset.id,
      detail: (caller) => stack.assets.getAsset({ callerUserId: caller, assetId: asset.id }),
      list: async (caller) =>
        (await stack.assets.listAssets({ callerUserId: caller })).map((row) => row.id),
    },
    {
      name: "Asset Memory",
      recordId: memory.id,
      // A detail on the household's Asset is reachable only through the Asset,
      // so its list read is the whole of its surface. Both entries are the same
      // question, which is exactly the point: the child never outlives the
      // parent's ceiling (ADR 0179).
      detail: async (caller) =>
        (await stack.assetReview.listAssetMemories({ callerUserId: caller, assetId: asset.id }))[0],
      list: async (caller) =>
        (
          await stack.assetReview.listAssetMemories({ callerUserId: caller, assetId: asset.id })
        ).map((row) => row.id),
    },
    {
      name: "Asset Evidence",
      recordId: evidence.id,
      detail: async (caller) =>
        (await stack.assetReview.listAssetEvidence({ callerUserId: caller, assetId: asset.id }))[0],
      list: async (caller) =>
        (
          await stack.assetReview.listAssetEvidence({ callerUserId: caller, assetId: asset.id })
        ).map((row) => row.id),
    },
    {
      name: "Event Plan",
      recordId: plan.id,
      detail: async (caller) =>
        (await stack.eventPlans.getHouseholdEventPlan({ callerUserId: caller, planId: plan.id }))
          .plan,
      list: async (caller) =>
        (await stack.eventPlans.listHouseholdEventPlans({ callerUserId: caller })).map(
          (row) => row.plan.id,
        ),
    },
    {
      name: "Context Fact",
      recordId: fact.id,
      detail: (caller) =>
        stack
          .contextFactsFor(caller)
          .getContextFact({ callerUserId: caller, contextFactId: fact.id }),
      list: async (caller) =>
        (
          await stack.contextFactsFor(caller).listHouseholdContextFacts({ callerUserId: caller })
        ).map((row) => row.id),
      search: async (caller) =>
        (
          await stack.contextFactsFor(caller).searchHouseholdContextFacts({
            callerUserId: caller,
            query: "bins",
            limit: 10,
            directlyRequested: true,
          })
        ).map((row) => row.fact.id),
    },
    {
      name: "Person Reference",
      recordId: reference.id,
      // No detail entry point exists by design (ADR 0218), so the list answers
      // both halves. A caller who cannot reach the host reaches no reference.
      detail: async (caller) =>
        (
          await stack.references.listPersonReferences({ actorUserId: caller, host: referenceHost })
        )[0],
      list: async (caller) =>
        (
          await stack.references.listPersonReferences({ actorUserId: caller, host: referenceHost })
        ).map((row) => row.id),
    },
  ];
}

/** Every family's member-owned record, Ana's, shared with the whole household. */
async function memberOwnedFamilies(stack: Stack, householdId: string): Promise<FamilyCase[]> {
  const item = await stack.savedItems.createSavedItem({
    ownerUserId: ANA,
    kind: "note",
    title: "Pick the paint up",
    scope: "household",
    householdId,
  });
  const action = await stack.actions.createGeneralAction({
    ownerUserId: ANA,
    title: "My dentist appointment",
    scope: "household",
    householdId,
  });
  const asset = await stack.assets.createAsset({
    ownerUserId: ANA,
    name: "Ana's estate car",
    kind: "vehicle",
    scope: "household",
    householdId,
  });
  const giftPlan = await stack.giftPlans.createGiftPlan({
    ownerUserId: ANA,
    subjectName: "Rowan",
    occasion: "Anniversary dinner",
    scope: "household",
    householdId,
  });

  return [
    {
      name: "Saved Item",
      recordId: item.id,
      detail: (caller) =>
        stack.savedItems.getSavedItem({ callerUserId: caller, savedItemId: item.id }),
      list: async (caller) =>
        (await stack.savedItems.listSavedItems({ callerUserId: caller })).map((row) => row.id),
      search: async (caller) =>
        (await stack.savedItems.searchSavedItems({ callerUserId: caller, query: "paint" })).map(
          (row) => row.id,
        ),
    },
    {
      name: "Action",
      recordId: action.id,
      detail: (caller) =>
        stack.actions.getGeneralAction({ actorUserId: caller, generalActionId: action.id }),
      list: async (caller) =>
        (await stack.actions.listActiveGeneralActions({ ownerUserId: caller })).map(
          (row) => row.id,
        ),
    },
    {
      name: "Asset",
      recordId: asset.id,
      detail: (caller) => stack.assets.getAsset({ callerUserId: caller, assetId: asset.id }),
      list: async (caller) =>
        (await stack.assets.listAssets({ callerUserId: caller })).map((row) => row.id),
    },
    {
      name: "Gift Plan",
      recordId: giftPlan.result.id,
      detail: (caller) =>
        stack.giftPlans.getGiftPlanDetail({ callerUserId: caller, giftPlanId: giftPlan.result.id }),
      list: async (caller) =>
        (await stack.giftPlans.listGiftPlans({ callerUserId: caller })).map((row) => row.id),
      search: async (caller) =>
        (await stack.giftPlans.searchGiftPlans({ callerUserId: caller, query: "Rowan" })).map(
          (row) => row.id,
        ),
    },
  ];
}

describe("the workspace's own records answer every access-changing event alike", () => {
  let stack: Stack;
  let householdId: string;
  let families: FamilyCase[];

  beforeEach(async () => {
    stack = seedStack();
    const workspace = await seedHouseholdWithMembers(stack.shared, {
      ownerUserId: ANA,
      name: "Home",
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });
    householdId = workspace.id;
    families = await householdNativeFamilies(stack, householdId);
  });

  it("shows every family to both members and to neither outsider surface", async () => {
    for (const family of families) {
      expect(await reach(family, ANA), `${family.name} for its creator`).toEqual(there(family));
      expect(await reach(family, BEN), `${family.name} for the other member`).toEqual(
        there(family),
      );
      expect(await reach(family, OUTSIDER), `${family.name} for a stranger`).toEqual(gone(family));
    }
  });

  it("closes every family to a removed member and leaves the rest of the household intact", async () => {
    await removeHouseholdMember(stack.shared, { householdId, userId: BEN });

    for (const family of families) {
      expect(await reach(family, BEN), `${family.name} after removal`).toEqual(gone(family));
      // The other half of the same assertion, and the one a blunt revocation
      // would break: what remains has to remain.
      expect(await reach(family, ANA), `${family.name} for the member who stayed`).toEqual(
        there(family),
      );
    }
  });

  it("closes every family to the creator too, once they are the one who left", async () => {
    // Ana made all of these, and none of them are hers. A household-native
    // record's `owner_user_id` — where the column exists at all — is a storage
    // key, and honouring it as an access path is the exact bug this proves
    // absent (ADR 0214).
    await removeHouseholdMember(stack.shared, { householdId, userId: ANA });

    for (const family of families) {
      expect(await reach(family, ANA), `${family.name} for its departed creator`).toEqual(
        gone(family),
      );
      expect(await reach(family, BEN), `${family.name} for the member who stayed`).toEqual(
        there(family),
      );
    }
  });

  it("closes every family to everyone once the household is dissolved", async () => {
    for (const userId of [ANA, BEN]) {
      await removeHouseholdMember(stack.shared, { householdId, userId });
    }
    await stack.shared.updateHouseholdWorkspace({
      householdId,
      patch: { status: "dissolved", dissolvedAt: new Date("2026-08-01T00:00:00.000Z") },
    });

    for (const family of families) {
      for (const caller of [ANA, BEN, OUTSIDER]) {
        expect(
          await reach(family, caller),
          `${family.name} for ${caller} after dissolution`,
        ).toEqual(gone(family));
      }
    }
  });
});

describe("a member's own records leave with them and stop being the household's", () => {
  let stack: Stack;
  let householdId: string;
  let families: FamilyCase[];

  beforeEach(async () => {
    stack = seedStack();
    const workspace = await seedHouseholdWithMembers(stack.shared, {
      ownerUserId: ANA,
      name: "Home",
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });
    householdId = workspace.id;
    families = await memberOwnedFamilies(stack, householdId);
  });

  it("shows them to the household while everyone is still in it", async () => {
    for (const family of families) {
      expect(await reach(family, ANA), `${family.name} for its owner`).toEqual(there(family));
      expect(await reach(family, BEN), `${family.name} for the other member`).toEqual(
        there(family),
      );
      expect(await reach(family, OUTSIDER), `${family.name} for a stranger`).toEqual(gone(family));
    }
  });

  it("closes them to a member who leaves, without taking them from their owner", async () => {
    await removeHouseholdMember(stack.shared, { householdId, userId: BEN });

    for (const family of families) {
      expect(await reach(family, BEN), `${family.name} after removal`).toEqual(gone(family));
      expect(await reach(family, ANA), `${family.name} for its owner`).toEqual(there(family));
    }
  });
});

/**
 * The audit the three ownership representations exist to survive.
 *
 * A household-native record says "the workspace owns this" three different ways:
 * a Saved Item has no owner column at all, an Action keeps its capturer's id as a
 * storage key, and an Asset records authorship beside an owner that means nothing
 * for access. Three representations is three chances for one of them to be read
 * as an access path, and the failure is silent in every case — the record simply
 * stays visible to the member who made it.
 */
describe("the three ownership representations are treated identically", () => {
  it("keeps the workspace's record after its creator leaves, whichever way ownership is stored", async () => {
    const stack = seedStack();
    const workspace = await seedHouseholdWithMembers(stack.shared, {
      ownerUserId: ANA,
      name: "Home",
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });

    // Each made by Ben, the member who is about to leave.
    const item = await stack.savedItemCollaboration.createHouseholdSavedItem({
      actorUserId: BEN,
      householdId: workspace.id,
      kind: "note",
      title: "Boiler service is due",
    });
    const action = await stack.actions.createGeneralAction({
      ownerUserId: BEN,
      title: "Put the bins out",
      ownership: "household_native",
      householdId: workspace.id,
    });
    const asset = await stack.assets.createAsset({
      ownerUserId: BEN,
      name: "Kitchen refrigerator",
      kind: "appliance",
      ownership: "household_native",
      householdId: workspace.id,
    });

    // The representations, stated as facts rather than assumed: no owner, an
    // owner that is a storage key, and an owner beside a separate creator.
    expect(item.ownerUserId).toBeNull();
    expect(item.createdByUserId).toBe(BEN);
    expect(action.ownerUserId).toBe(BEN);
    expect(action.ownership).toBe("household_native");
    expect(asset.ownerUserId).toBe(BEN);
    expect(asset.createdByUserId).toBe(BEN);

    await removeHouseholdMember(stack.shared, { householdId: workspace.id, userId: BEN });

    // Ana keeps all three; Ben keeps none, including the two whose owner column
    // still names him.
    await expect(
      stack.savedItems.getSavedItem({ callerUserId: ANA, savedItemId: item.id }),
    ).resolves.toMatchObject({ id: item.id });
    await expect(
      stack.savedItems.getSavedItem({ callerUserId: BEN, savedItemId: item.id }),
    ).resolves.toBeNull();

    await expect(
      stack.actions.getGeneralAction({ actorUserId: ANA, generalActionId: action.id }),
    ).resolves.toMatchObject({ id: action.id });
    await expect(
      stack.actions.getGeneralAction({ actorUserId: BEN, generalActionId: action.id }),
    ).rejects.toThrow(HouseholdRecordUnavailableError);

    await expect(
      stack.assets.getAsset({ callerUserId: ANA, assetId: asset.id }),
    ).resolves.toMatchObject({ id: asset.id });
    await expect(
      stack.assets.getAsset({ callerUserId: BEN, assetId: asset.id }),
    ).resolves.toBeNull();

    // And the attribution survives, because factual authorship is what the
    // household keeps when standing ends (CONTEXT.md, ADR 0214).
    await expect(
      stack.savedItems.getSavedItem({ callerUserId: ANA, savedItemId: item.id }),
    ).resolves.toMatchObject({ createdByUserId: BEN });
  });
});

describe("the Surprise Subject is excluded wherever a Gift Plan can be reached", () => {
  it("hides a plan from its subject on detail and list, ahead of their active membership", async () => {
    const stack = seedStack();
    const workspace = await seedHouseholdWithMembers(stack.shared, {
      ownerUserId: ANA,
      name: "Home",
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });
    const surprise = await stack.giftPlans.createGiftPlan({
      ownerUserId: BEN,
      subjectName: "Ana",
      occasion: "Birthday",
      surpriseSubjectUserId: ANA,
      scope: "household",
      householdId: workspace.id,
    });
    const ordinary = await stack.giftPlans.createGiftPlan({
      ownerUserId: BEN,
      subjectName: "Rowan",
      occasion: "Anniversary dinner",
      scope: "household",
      householdId: workspace.id,
    });

    const subject: FamilyCase = {
      name: "Gift Plan",
      recordId: surprise.result.id,
      detail: (caller) =>
        stack.giftPlans.getGiftPlanDetail({ callerUserId: caller, giftPlanId: surprise.result.id }),
      list: async (caller) =>
        (await stack.giftPlans.listGiftPlans({ callerUserId: caller })).map((row) => row.id),
      search: async (caller) =>
        (await stack.giftPlans.searchGiftPlans({ callerUserId: caller, query: "Ana" })).map(
          (row) => row.id,
        ),
    };

    // Ana is an active member of a household-scope plan and still cannot reach
    // it. Nothing about the refusal distinguishes it from a plan that does not
    // exist, which is the whole of the protection: an "unavailable" that only
    // appears for the subject would announce the surprise.
    expect(await reach(subject, ANA)).toEqual(gone(subject));
    expect(await reach(subject, BEN)).toEqual(there(subject));
    // And the exclusion is aimed: the household's other plan is untouched.
    await expect(stack.giftPlans.listGiftPlans({ callerUserId: ANA })).resolves.toMatchObject([
      { id: ordinary.result.id },
    ]);
  });
});

describe("narrowing an audience revokes as completely as a departure", () => {
  it("drops a member from a selected audience across detail and list", async () => {
    const stack = seedStack();
    const workspace = await seedHouseholdWithMembers(stack.shared, {
      ownerUserId: ANA,
      name: "Home",
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });
    const item = await stack.savedItems.createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "Pick the paint up",
      scope: "shared",
      householdId: workspace.id,
      selectedUserIds: [BEN],
    });
    const family: FamilyCase = {
      name: "Saved Item",
      recordId: item.id,
      detail: (caller) =>
        stack.savedItems.getSavedItem({ callerUserId: caller, savedItemId: item.id }),
      list: async (caller) =>
        (await stack.savedItems.listSavedItems({ callerUserId: caller })).map((row) => row.id),
    };

    expect(await reach(family, BEN)).toEqual(there(family));

    // Ben stays in the household throughout. Only the selection changed, and
    // that has to be enough on its own.
    await stack.household.shareRecordWithSelectedMembers({
      actorUserId: ANA,
      householdId: workspace.id,
      recordKind: "saved_item",
      recordId: item.id,
      selectedUserIds: [],
    });

    expect(await reach(family, BEN)).toEqual(gone(family));
    expect(await reach(family, ANA)).toEqual(there(family));
  });
});

/**
 * The family with no household-native form at all.
 *
 * Every Memory, Source Record, and Follow-Up is somebody's, so the workspace
 * never owns one and a departure returns all of them. That makes this the one
 * family whose whole answer to "what does ending access mean" is the
 * member-owned half — and the one where a share row outliving a membership would
 * be the entire leak, because there is no ownership form left to fall back on.
 */
describe("shared relationship records answer the same events", () => {
  const MEMORY_ID = "44444444-4444-4444-8444-444444444444";

  async function seedShares() {
    const shared = createInMemorySavedItemLifecycleStore();
    const workspace = await seedHouseholdWithMembers(shared, {
      ownerUserId: ANA,
      name: "Home",
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });
    const store = createInMemoryRelationshipShareStore(
      {
        records: [
          {
            recordKind: "memory",
            recordId: MEMORY_ID,
            ownerUserId: ANA,
            personId: "55555555-5555-4555-8555-555555555555",
            scope: "household",
            householdId: workspace.id,
            sensitivity: "normal",
            lifecycle: "active",
            shareable: true,
            body: "Rowan is allergic to shellfish.",
            recordedAt: new Date("2026-07-01T00:00:00.000Z"),
            dueAt: null,
            trust: "high",
          },
        ],
        memberNames: { [ANA]: "Ana", [BEN]: "Ben" },
      },
      shared,
    );
    return { shared, store, householdId: workspace.id, sharing: createRelationshipSharing(store) };
  }

  const familyFor = (sharing: ReturnType<typeof createRelationshipSharing>): FamilyCase => ({
    name: "shared Memory",
    recordId: MEMORY_ID,
    detail: (caller) =>
      sharing.readSharedRelationshipRecord({
        callerUserId: caller,
        recordKind: "memory",
        recordId: MEMORY_ID,
      }),
    // The family's only read is the record itself, so the list surface is the
    // same question asked of the same proof. Stated rather than omitted, so the
    // battery's shape is uniform and a future list read has somewhere to go.
    list: async (caller) =>
      (await sharing.readSharedRelationshipRecord({
        callerUserId: caller,
        recordKind: "memory",
        recordId: MEMORY_ID,
      }))
        ? [MEMORY_ID]
        : [],
  });

  it("shows a household-scope memory to the household and to nobody else", async () => {
    const { sharing } = await seedShares();
    const family = familyFor(sharing);

    expect(await reach(family, ANA)).toEqual(there(family));
    expect(await reach(family, BEN)).toEqual(there(family));
    expect(await reach(family, OUTSIDER)).toEqual(gone(family));
  });

  it("closes it to a removed member while its owner keeps it", async () => {
    const { shared, householdId, sharing } = await seedShares();
    const family = familyFor(sharing);

    await removeHouseholdMember(shared, { householdId, userId: BEN });

    expect(await reach(family, BEN)).toEqual(gone(family));
    expect(await reach(family, ANA)).toEqual(there(family));
  });

  it("closes it to everyone, its owner included, until the sweep brings it home", async () => {
    const { shared, store, householdId, sharing } = await seedShares();
    const family = familyFor(sharing);

    for (const userId of [ANA, BEN]) {
      await removeHouseholdMember(shared, { householdId, userId });
    }
    await shared.updateHouseholdWorkspace({
      householdId,
      patch: { status: "dissolved", dissolvedAt: new Date("2026-08-01T00:00:00.000Z") },
    });

    expect(await reach(family, BEN)).toEqual(gone(family));
    // Ana owns this record and cannot read it either, which is not a bug and is
    // the whole reason the member-owned revert exists: a `household`-scope
    // record needs a current active membership before ownership is consulted,
    // so the moment the household ends it is briefly readable by nobody at all.
    // Fail-closed is the right direction to be wrong in, and it is why the
    // revert is load-bearing rather than tidying.
    expect(await reach(family, ANA)).toEqual(gone(family));

    // What the dissolution sweep writes for every member-owned record.
    await store.updateRelationshipRecordVisibility({
      recordKind: "memory",
      recordId: MEMORY_ID,
      ownerUserId: ANA,
      scope: "private",
      householdId: null,
    });

    expect(await reach(family, ANA)).toEqual(there(family));
    for (const caller of [BEN, OUTSIDER]) {
      expect(await reach(family, caller)).toEqual(gone(family));
    }
  });
});

/**
 * The recovery boundary, stated as an absence.
 *
 * "Support can put it back for thirty days" is a promise about a human process,
 * not about a product path, and the difference matters: if any surface could
 * still reach a dissolved household's content, the recovery window would be a
 * month in which everyone who had just been told their access ended could go on
 * reading. So the household is reachable only through a current active
 * membership, dissolution ends every one of them, and that leaves no argument
 * any caller can supply that names the workspace.
 */
describe("a dissolved household is readable by nobody through any product path", () => {
  it("leaves its former members with no overview and no records", async () => {
    const stack = seedStack();
    const workspace = await seedHouseholdWithMembers(stack.shared, {
      ownerUserId: ANA,
      name: "Home",
      members: [
        [ANA, "owner"],
        [BEN, "member"],
      ],
    });
    const families = await householdNativeFamilies(stack, workspace.id);
    const overviewFor = createHouseholdOverviewReader(stack.shared, {
      listUserIdentities: async ({ userIds }) =>
        userIds.map((id) => ({ id, name: id, email: `${id}@example.test` })),
    });

    await expect(overviewFor({ userId: ANA })).resolves.toMatchObject({
      householdId: workspace.id,
    });

    for (const userId of [ANA, BEN]) {
      await removeHouseholdMember(stack.shared, { householdId: workspace.id, userId });
    }
    await stack.shared.updateHouseholdWorkspace({
      householdId: workspace.id,
      patch: { status: "dissolved", dissolvedAt: new Date("2026-08-01T00:00:00.000Z") },
    });

    for (const userId of [ANA, BEN, OUTSIDER]) {
      // Null, not a tombstone view. A dissolved household that still rendered a
      // name, a member count, or a "recover" affordance would be the recovery
      // window handing back exactly what dissolution took away.
      await expect(overviewFor({ userId }), `overview for ${userId}`).resolves.toBeNull();
      for (const family of families) {
        expect(await reach(family, userId), `${family.name} for ${userId}`).toEqual(gone(family));
      }
    }
  });
});
