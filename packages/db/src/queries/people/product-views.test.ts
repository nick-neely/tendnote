import type {
  Followup,
  HouseholdMembership,
  Memory,
  MemoryStatus,
  MessageDraft,
  MessageDraftStatus,
  Sensitivity,
} from "@tendnote/domain";
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

const COUNTED_PERSON = "counted-person";
const COUNTED_AT = new Date("2026-07-24T12:00:00.000Z");

function memory(input: {
  id: string;
  status: MemoryStatus;
  sensitivity?: Sensitivity;
  ownerUserId?: string;
}) {
  return {
    id: input.id,
    personId: COUNTED_PERSON,
    ownerUserId: input.ownerUserId ?? OWNER,
    sourceRecordId: "source-1",
    memoryType: "context",
    content: "Remembered something",
    status: input.status,
    importance: 3,
    sensitivity: input.sensitivity ?? "normal",
    confidence: "medium",
    scope: "private",
    householdId: null,
    approvedAt: null,
    dismissedAt: null,
    createdAt: COUNTED_AT,
    updatedAt: COUNTED_AT,
  } as Memory;
}

function followup(input: { id: string; status: Followup["status"] }) {
  return {
    id: input.id,
    personId: COUNTED_PERSON,
    ownerUserId: OWNER,
    reason: "Check in",
    dueAt: COUNTED_AT,
    status: input.status,
    scope: "private",
    householdId: null,
    sourceRecordId: null,
    cadence: null,
    createdAt: COUNTED_AT,
    updatedAt: COUNTED_AT,
    lastActorUserId: null,
  } as Followup;
}

function draft(input: { id: string; status: MessageDraftStatus }) {
  return {
    id: input.id,
    personId: COUNTED_PERSON,
    ownerUserId: OWNER,
    channel: "text",
    purpose: "check_in",
    body: "Hey, thinking of you.",
    status: input.status,
    sourceRefs: [],
    createdAt: COUNTED_AT,
    updatedAt: COUNTED_AT,
  } as MessageDraft;
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
      counts: { memories: 0, review: 0, followups: 0, drafts: 0 },
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
      counts: { memories: 4, review: 1, followups: 2, drafts: 3 },
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
      counts: { memories: 4, review: 1, followups: 2, drafts: 3 },
    });
  });

  it("counts each person-detail tab as exactly what its label claims", async () => {
    const views = createPeopleProductQueries(
      createInMemoryPeopleStore({
        people: [person({ id: COUNTED_PERSON, ownerUserId: OWNER, displayName: "Cal" })],
        memories: [
          memory({ id: "confirmed", status: "approved" }),
          // Approved but restricted: the ledger will not show it, so it is not
          // one of the "confirmed facts you've saved" either.
          memory({ id: "restricted", status: "approved", sensitivity: "restricted" }),
          memory({ id: "suggestion-1", status: "suggested" }),
          memory({ id: "suggestion-2", status: "suggested" }),
          memory({ id: "dismissed", status: "dismissed" }),
          memory({ id: "other-owner", status: "approved", ownerUserId: OTHER_OWNER }),
        ],
        followups: [
          followup({ id: "open", status: "open" }),
          followup({ id: "proposed", status: "suggested" }),
          followup({ id: "done", status: "completed" }),
        ],
        messageDrafts: [
          draft({ id: "written", status: "draft" }),
          draft({ id: "approved", status: "approved" }),
          draft({ id: "sent", status: "sent_manually" }),
        ],
      }),
    );

    // Memories counts confirmed facts only - suggestions are review work, which is
    // the contradiction the person header used to show ("Memories 3" over an empty
    // Memories section).
    await expect(
      views.detail({ ownerUserId: OWNER, personId: COUNTED_PERSON }),
    ).resolves.toMatchObject({
      counts: { memories: 1, review: 2, followups: 2, drafts: 2 },
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
