import type { Followup, HouseholdMembership } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import type { HouseholdRecordShare } from "../households/types";
import { createInMemoryPeopleStore } from "./in-memory-store";
import { createPeopleProductQueries } from "./product-views";

const OWNER = "owner-a";
const OTHER_OWNER = "owner-b";
const VIEWER = "household-viewer";
const OUTSIDER = "outside-household";

function person(input: { id: string; ownerUserId: string; displayName: string }) {
  const now = new Date("2026-07-24T12:00:00.000Z");
  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    displayName: input.displayName,
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend" as const,
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual" as const,
    createdAt: now,
    updatedAt: now,
  };
}

describe("People product views", () => {
  it("returns bounded serialized views without crossing two owners", async () => {
    const views = createPeopleProductQueries(
      createInMemoryPeopleStore({
        people: [
          person({ id: "owner-person", ownerUserId: OWNER, displayName: "Ada Owner" }),
          person({ id: "other-person", ownerUserId: OTHER_OWNER, displayName: "Bea Other" }),
        ],
      }),
    );

    await expect(views.list({ ownerUserId: OWNER, limit: 50 })).resolves.toEqual([
      {
        id: "owner-person",
        displayName: "Ada Owner",
        firstName: null,
        lastName: null,
        birthday: null,
        profileBlurb: null,
        relationshipType: "friend",
      },
    ]);
    await expect(
      views.detail({ ownerUserId: OWNER, personId: "other-person" }),
    ).resolves.toBeNull();

    const detail = await views.detail({ ownerUserId: OWNER, personId: "owner-person" });
    expect(detail).toEqual({
      person: {
        id: "owner-person",
        displayName: "Ada Owner",
        firstName: null,
        lastName: null,
        birthday: null,
        profileBlurb: null,
        relationshipType: "friend",
        closenessLevel: 3,
      },
      counts: { memories: 0, followups: 0, sourceRecords: 0 },
    });
    expect(JSON.stringify(detail)).not.toContain(OWNER);
  });

  it("honors the bounded list limit before serializing a product view", async () => {
    const views = createPeopleProductQueries(
      createInMemoryPeopleStore({
        people: [
          person({ id: "ada", ownerUserId: OWNER, displayName: "Ada" }),
          person({ id: "bea", ownerUserId: OWNER, displayName: "Bea" }),
        ],
      }),
    );

    await expect(views.list({ ownerUserId: OWNER, limit: 1 })).resolves.toEqual([
      {
        id: "ada",
        displayName: "Ada",
        firstName: null,
        lastName: null,
        birthday: null,
        profileBlurb: null,
        relationshipType: "friend",
      },
    ]);
  });

  it("uses the bounded core/count seam instead of loading profile collections", async () => {
    const boundedCore = {
      person: person({ id: "owner-person", ownerUserId: OWNER, displayName: "Ada Owner" }),
      counts: { memories: 4, followups: 2, sourceRecords: 1 },
    };
    const views = createPeopleProductQueries({
      searchPeople: async () => [],
      getPersonDetailCore: async () => boundedCore,
    });

    await expect(views.detail({ ownerUserId: OWNER, personId: "owner-person" })).resolves.toEqual({
      person: {
        id: "owner-person",
        displayName: "Ada Owner",
        firstName: null,
        lastName: null,
        birthday: null,
        profileBlurb: null,
        relationshipType: "friend",
        closenessLevel: 3,
      },
      counts: { memories: 4, followups: 2, sourceRecords: 1 },
    });
  });

  it("keeps a viewer-visible detail isolated from private and unrelated callers", async () => {
    const shared = person({ id: "shared-person", ownerUserId: OTHER_OWNER, displayName: "Bea" });
    const now = new Date("2026-07-24T12:00:00.000Z");
    const sharedFollowup = {
      id: "shared-followup",
      ownerUserId: OTHER_OWNER,
      personId: shared.id,
      reason: "Check in",
      dueAt: now,
      status: "open",
      scope: "shared",
      householdId: "household-1",
      sourceRecordId: null,
      cadence: null,
      createdAt: now,
      updatedAt: now,
      lastActorUserId: null,
    } as Followup;
    const membership = {
      id: "membership-1",
      householdId: "household-1",
      userId: VIEWER,
      invitedByUserId: OTHER_OWNER,
      role: "member",
      status: "active",
      invitedAt: now,
      acceptedAt: now,
      removedAt: null,
      createdAt: now,
      updatedAt: now,
    } as HouseholdMembership;
    const share = {
      id: "share-1",
      householdId: "household-1",
      recordKind: "followup",
      recordId: sharedFollowup.id,
      sharedWithUserId: VIEWER,
      sharedByUserId: OTHER_OWNER,
      createdAt: now,
    } as HouseholdRecordShare;
    const views = createPeopleProductQueries(
      createInMemoryPeopleStore({
        people: [shared],
        followups: [sharedFollowup],
        householdMemberships: [membership],
        householdRecordShares: [share],
      }),
    );

    await expect(views.detail({ ownerUserId: VIEWER, personId: shared.id })).resolves.toMatchObject(
      {
        person: { id: shared.id, displayName: "Bea" },
        counts: { followups: 1 },
      },
    );
    await expect(views.detail({ ownerUserId: OWNER, personId: shared.id })).resolves.toBeNull();
    await expect(views.detail({ ownerUserId: OUTSIDER, personId: shared.id })).resolves.toBeNull();
    await expect(views.detail({ ownerUserId: OUTSIDER, personId: "missing" })).resolves.toBeNull();
  });
});
