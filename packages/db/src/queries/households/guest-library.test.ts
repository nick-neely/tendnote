import type { GuestLibrary, GuestLibraryDomain } from "@tendnote/domain/guest-library";
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryAssetStore } from "../assets/in-memory-store";
import { createAssetLifecycle } from "../assets/lifecycle";
import { contextFactFixture } from "../context-fact-fixtures";
import { createContextFactQueries, createInMemoryContextFactStore } from "../context-facts";
import { createInMemoryGeneralActionAreaStore } from "../general-action-areas/in-memory-store";
import { createInMemoryGeneralActionStore } from "../general-actions/in-memory-store";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { createInMemoryGiftPlanStore } from "../gift-plans/in-memory-store";
import { createGiftPlanLifecycle } from "../gift-plans/lifecycle";
import { createInMemoryRelationshipShareStore } from "../relationship-shares/in-memory-store";
import { createRelationshipSharing } from "../relationship-shares/sharing";
import type { RelationshipRecordFacts } from "../relationship-shares/types";
import { createInMemorySavedItemLifecycleStore } from "../saved-items/in-memory-store";
import { createGuestLibraryReader, type GuestLibraryReads } from "./guest-library";
import { removeHouseholdMember, seedHouseholdWithMembers } from "./household-fixtures";

/**
 * The prototype's fixture (docs/phase-9b/prototypes/household-guest-experience.html),
 * lifted into the real domain reads: two Household Owners, one Household Guest,
 * the readable records across the eight read-set domains, and the records that
 * must never reach the guest. The prototype's two household-scope People (June,
 * Ruth) have no counterpart: a Person is always its owner's, so a guest meets
 * them only as the label on a record shared with them ("About June Okonkwo"). Every family runs through its own in-memory
 * lifecycle over ONE household store, so the guest gate is proven on top of the
 * same proofs members get, not on hand-made rows.
 */
const ADAEZE = "adaeze";
const MARCUS = "marcus";
const TILLY = "tilly";
const NAMES = { [ADAEZE]: "Adaeze Okonkwo", [MARCUS]: "Marcus Reyes", [TILLY]: "Tilly Brennan" };

/** Every withheld record's text. None may appear anywhere in the guest's library. */
const WITHHELD = [
  "Adaeze's therapist",
  "A Memory Marcus kept to himself",
  "Tilly's birthday",
  "Only for Marcus",
  "A suggestion nobody approved",
  "Adaeze's own errand",
  "Adaeze's private laptop",
  "Suggested: the household is vegetarian",
];

function relationshipRecord(
  overrides: Partial<RelationshipRecordFacts> & Pick<RelationshipRecordFacts, "recordId" | "body">,
): RelationshipRecordFacts {
  return {
    recordKind: "memory",
    ownerUserId: ADAEZE,
    personId: "june",
    scope: "private",
    householdId: null,
    sensitivity: "normal",
    lifecycle: "active",
    shareable: true,
    recordedAt: new Date("2026-09-12T00:00:00Z"),
    trust: "high",
    dueAt: null,
    ...overrides,
  };
}

async function seedPrototypeHousehold() {
  const shared = createInMemorySavedItemLifecycleStore();
  const household = await seedHouseholdWithMembers(shared, {
    ownerUserId: ADAEZE,
    name: "The Reyes-Okonkwo household",
    members: [
      [ADAEZE, "owner"],
      [MARCUS, "owner"],
      [TILLY, "member"],
    ],
  });
  const householdId = household.id;

  const shareStore = createInMemoryRelationshipShareStore(
    {
      records: [
        relationshipRecord({
          recordId: "m1",
          body: "June is moving to a ground-floor flat in April",
        }),
        relationshipRecord({
          recordId: "m2",
          ownerUserId: MARCUS,
          personId: null,
          body: "The boiler service contract renews every October",
        }),
        relationshipRecord({
          recordId: "m3",
          ownerUserId: MARCUS,
          personId: "ruth",
          body: "Ruth only does house calls on Fridays",
        }),
        relationshipRecord({ recordId: "pX", personId: "therapist", body: "Adaeze's therapist" }),
        relationshipRecord({
          recordId: "mX",
          ownerUserId: MARCUS,
          body: "A Memory Marcus kept to himself",
        }),
        relationshipRecord({ recordId: "mY", body: "Only for Marcus" }),
        relationshipRecord({
          recordId: "mZ",
          ownerUserId: MARCUS,
          body: "A suggestion nobody approved",
          shareable: false,
        }),
        relationshipRecord({
          recordKind: "followup",
          recordId: "f1",
          body: "Ring June about the flat",
          dueAt: new Date("2026-10-04T00:00:00Z"),
        }),
        relationshipRecord({
          recordKind: "followup",
          recordId: "f2",
          ownerUserId: MARCUS,
          personId: null,
          body: "Confirm the caterer for June's eightieth",
          dueAt: new Date("2027-02-12T00:00:00Z"),
        }),
      ],
      personLabels: { [`${ADAEZE}:june`]: "June Okonkwo", [`${MARCUS}:ruth`]: "Ruth Halvorsen" },
      memberNames: NAMES,
    },
    shared,
  );
  const sharing = createRelationshipSharing(shareStore);
  const share = (
    ownerUserId: string,
    recordKind: "memory" | "followup",
    recordId: string,
    selectedUserIds?: string[],
  ) =>
    sharing.shareRelationshipRecord({
      ownerUserId,
      recordKind,
      recordId,
      visibilityChoice: selectedUserIds ? "selected_members" : "whole_household",
      selectedUserIds,
    });
  await share(ADAEZE, "memory", "m1", [TILLY, MARCUS]);
  await share(MARCUS, "memory", "m2");
  await share(MARCUS, "memory", "m3", [TILLY]);
  await share(ADAEZE, "memory", "mY", [MARCUS]);
  await share(ADAEZE, "followup", "f1", [TILLY]);
  await share(MARCUS, "followup", "f2");

  const actions = createGeneralActionLifecycle({
    ...createInMemoryGeneralActionAreaStore(),
    ...createInMemoryGeneralActionStore(shared),
    getPerson: (input) => shared.getPerson(input),
    getSourceRecord: (input) => shared.getSourceRecord(input),
    getVisibleSourceRecord: (input) => shared.getVisibleSourceRecord(input),
  });
  await actions.createGeneralAction({
    ownerUserId: ADAEZE,
    title: "Bleed the upstairs radiators",
    ownership: "household_native",
    householdId,
  });
  await actions.createGeneralAction({
    ownerUserId: MARCUS,
    title: "Renew the house insurance",
    notes: "Renewal quote came in at 412 pounds. Marcus is comparing.",
    ownership: "household_native",
    householdId,
    responsibilityHolderUserId: MARCUS,
    dueAt: new Date("2026-11-30T00:00:00Z"),
  });
  await actions.createGeneralAction({ ownerUserId: ADAEZE, title: "Adaeze's own errand" });

  const assetStore = createInMemoryAssetStore(shared);
  const assets = createAssetLifecycle({ ...shared, ...assetStore } as Parameters<
    typeof createAssetLifecycle
  >[0]);
  for (const [name, kind] of [
    ["Worcester Bosch boiler", "appliance"],
    ["Volvo V60", "vehicle"],
    ["Miele W1 washing machine", "appliance"],
  ] as const) {
    await assets.createAsset({
      ownerUserId: ADAEZE,
      name,
      kind,
      ownership: "household_native",
      householdId,
    });
  }
  await assets.createAsset({ ownerUserId: ADAEZE, name: "Adaeze's private laptop", kind: "item" });

  const giftPlans = createGiftPlanLifecycle({
    plans: createInMemoryGiftPlanStore(shared),
    households: shared,
  });
  await giftPlans.createGiftPlan({
    ownerUserId: ADAEZE,
    subjectName: "June Okonkwo",
    occasion: "June's eightieth",
    occasionOn: new Date("2027-03-14T00:00:00Z"),
    scope: "shared",
    householdId,
    selectedUserIds: [MARCUS, TILLY],
  });
  await giftPlans.createGiftPlan({
    ownerUserId: ADAEZE,
    subjectName: "Tilly",
    occasion: "Tilly's birthday",
    surpriseSubjectUserId: TILLY,
    scope: "household",
    householdId,
  });

  const contextFactStore = createInMemoryContextFactStore(
    [
      contextFactFixture({
        id: "suggested-fact",
        subject: { kind: "household", householdId },
        content: "Suggested: the household is vegetarian",
        lifecycle: "suggested",
        reviewedAt: null,
        creatorUserId: ADAEZE,
        lastActorUserId: ADAEZE,
      }),
    ],
    { householdAccess: shared },
  );
  const contextFactsFor = (userId: string) =>
    createContextFactQueries(contextFactStore, {
      householdAccess: shared,
      sourceRecords: { getSourceRecordById: async () => null },
      resolveVerifiedCaller: async () => userId,
    });
  for (const content of [
    "The household eats together on Sunday evenings",
    "Bins go out on Tuesday night, recycling on alternate weeks",
  ]) {
    await contextFactsFor(ADAEZE).createHouseholdContextFact({
      callerUserId: ADAEZE,
      category: "preference",
      content,
    });
  }

  const reads: GuestLibraryReads = {
    readHousehold: async ({ userId }) => {
      const [membership] = await shared.listActiveHouseholdMembershipsForUser({ userId });
      if (!membership) return null;
      const members = await shared.listHouseholdMemberships({
        householdId: membership.householdId,
        status: "active",
      });
      return {
        name: household.name,
        members: members.map((member) => ({
          userId: member.userId,
          name: NAMES[member.userId as keyof typeof NAMES],
          role: member.role,
        })),
      };
    },
    listSharedRelationshipRecords: (input) => sharing.listSharedRelationshipRecords(input),
    listActiveGeneralActions: (input) => actions.listActiveGeneralActions(input),
    listAssets: (input) => assets.listAssets(input),
    listGiftPlans: (input) => giftPlans.listGiftPlans(input),
    listHouseholdContextFacts: ({ callerUserId }) =>
      contextFactsFor(callerUserId).listHouseholdContextFacts({ callerUserId }),
    listCalendarEvents: async () =>
      ["June's eightieth birthday lunch", "Boiler service"].map((title, index) => ({
        id: `event-${index}`,
        title,
        context: "Household calendar",
        body: null,
        belongsTo: null,
        date: new Date("2026-10-03T09:00:00Z"),
        scope: "household" as const,
        householdNative: true,
        viewerIsOwner: false,
      })),
  };
  return { shared, householdId, reads };
}

function titles(library: GuestLibrary | null, domain: GuestLibraryDomain) {
  const shelf = library?.shelves.find((candidate) => candidate.domain === domain);
  return shelf?.records.map((record) => record.title).sort();
}

describe("the Household Guest library over the prototype fixture", () => {
  let fixture: Awaited<ReturnType<typeof seedPrototypeHousehold>>;
  let library: GuestLibrary | null;

  beforeEach(async () => {
    fixture = await seedPrototypeHousehold();
    library = await createGuestLibraryReader(fixture.reads)({ guestUserId: TILLY });
  });

  it("shelves every readable record in its domain, and the eight domains in order", () => {
    expect(library?.householdName).toBe("The Reyes-Okonkwo household");
    expect(library?.shelves.map((shelf) => shelf.domain)).toEqual([
      "people",
      "memories",
      "followUps",
      "generalActions",
      "assets",
      "giftPlans",
      "householdContext",
      "calendarEvents",
    ]);
    expect(titles(library, "people")).toEqual(["Adaeze Okonkwo", "Marcus Reyes"]);
    expect(titles(library, "memories")).toEqual([
      "June is moving to a ground-floor flat in April",
      "Ruth only does house calls on Fridays",
      "The boiler service contract renews every October",
    ]);
    expect(titles(library, "followUps")).toEqual([
      "Confirm the caterer for June's eightieth",
      "Ring June about the flat",
    ]);
    expect(titles(library, "generalActions")).toEqual([
      "Bleed the upstairs radiators",
      "Renew the house insurance",
    ]);
    expect(titles(library, "assets")).toEqual([
      "Miele W1 washing machine",
      "Volvo V60",
      "Worcester Bosch boiler",
    ]);
    expect(titles(library, "giftPlans")).toEqual(["June's eightieth"]);
    expect(titles(library, "householdContext")).toEqual([
      "Bins go out on Tuesday night, recycling on alternate weeks",
      "The household eats together on Sunday evenings",
    ]);
    expect(titles(library, "calendarEvents")).toHaveLength(2);
    expect(library?.shelves.flatMap((shelf) => shelf.records)).toHaveLength(17);
  });

  it("never renders, counts, or implies a withheld record", () => {
    const serialized = JSON.stringify(library);
    for (const withheld of WITHHELD) expect(serialized).not.toContain(withheld);
  });

  it("states each record's owner and why the guest can see it", () => {
    const records = library?.shelves.flatMap((shelf) => shelf.records) ?? [];
    const byTitle = (title: string) => records.find((record) => record.title === title);

    expect(byTitle("June is moving to a ground-floor flat in April")).toMatchObject({
      belongsTo: "Adaeze Okonkwo",
      reason: "shared_scope",
      context: "About June Okonkwo",
    });
    expect(byTitle("The boiler service contract renews every October")).toMatchObject({
      belongsTo: "Marcus Reyes",
      reason: "household_scope",
    });
    expect(byTitle("Renew the house insurance")).toMatchObject({
      belongsTo: null,
      reason: "household_native",
      context: "Looked after by Marcus Reyes",
    });
    expect(byTitle("June's eightieth")).toMatchObject({
      belongsTo: "Adaeze Okonkwo",
      reason: "shared_scope",
      context: "For June Okonkwo",
    });
    expect(byTitle("Marcus Reyes")).toMatchObject({ reason: "household_native" });
  });

  it("shows a domain with nothing readable as an empty shelf, never a missing one", async () => {
    const library = await createGuestLibraryReader({
      ...fixture.reads,
      listGiftPlans: async () => [],
    })({ guestUserId: TILLY });

    expect(library?.shelves.find((shelf) => shelf.domain === "giftPlans")).toEqual({
      domain: "giftPlans",
      records: [],
      unavailable: false,
    });
  });

  it("marks a failed domain unavailable without hiding the others", async () => {
    const library = await createGuestLibraryReader({
      ...fixture.reads,
      listCalendarEvents: async () => {
        throw new Error("provider down");
      },
    })({ guestUserId: TILLY });

    expect(library?.shelves.find((shelf) => shelf.domain === "calendarEvents")).toMatchObject({
      records: [],
      unavailable: true,
    });
    expect(titles(library, "assets")).toHaveLength(3);
  });

  it("drops the guest's own records even where a member read would return them", async () => {
    const library = await createGuestLibraryReader({
      ...fixture.reads,
      listGiftPlans: async (input) => [
        ...(await fixture.reads.listGiftPlans(input)),
        {
          ...(await fixture.reads.listGiftPlans(input))[0],
          id: "own-plan",
          ownerUserId: TILLY,
          occasion: "Tilly's own plan",
        } as Awaited<ReturnType<GuestLibraryReads["listGiftPlans"]>>[number],
      ],
    })({ guestUserId: TILLY });

    expect(titles(library, "giftPlans")).toEqual(["June's eightieth"]);
  });

  it("reads nothing once the guest's membership ends", async () => {
    await removeHouseholdMember(fixture.shared, {
      householdId: fixture.householdId,
      userId: TILLY,
    });

    expect(await createGuestLibraryReader(fixture.reads)({ guestUserId: TILLY })).toBeNull();
  });
});
