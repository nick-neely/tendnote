import type { HouseholdMembership, Memory, Person } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import type { HouseholdRecordShare } from "../households/types";
import { createInMemoryRelationshipContextSearchStore } from "./in-memory-store";
import { createRelationshipContextSearchQueries } from "./queries";

const now = new Date("2026-06-26T00:00:00Z");
const maraId = "11111111-1111-4111-8111-111111111111";
const noahId = "22222222-2222-4222-8222-222222222222";

function person(overrides: Partial<Person>): Person {
  return {
    id: maraId,
    ownerUserId: "owner-1",
    displayName: "Mara Lin",
    firstName: "Mara",
    lastName: "Lin",
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function memory(overrides: Partial<Memory>): Memory {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    personId: maraId,
    ownerUserId: "owner-1",
    householdId: null,
    sourceRecordId: "99999999-9999-4999-8999-999999999999",
    memoryType: "context",
    content: "Mara prefers backend architecture conversations in Nashville.",
    status: "approved",
    importance: 3,
    sensitivity: "normal",
    confidence: "medium",
    scope: "private",
    approvedAt: now,
    dismissedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function householdMembership(overrides: Partial<HouseholdMembership>): HouseholdMembership {
  return {
    id: `membership-${overrides.userId ?? "user"}`,
    householdId: "99999999-9999-4999-8999-999999999999",
    userId: "member-1",
    invitedByUserId: "owner-1",
    role: "member",
    status: "active",
    invitedAt: now,
    acceptedAt: now,
    removedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function householdRecordShare(overrides: Partial<HouseholdRecordShare>): HouseholdRecordShare {
  return {
    id: `share-${overrides.recordId ?? "record"}`,
    householdId: "99999999-9999-4999-8999-999999999999",
    recordKind: "memory",
    recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sharedWithUserId: "member-1",
    sharedByUserId: "owner-1",
    createdAt: now,
    ...overrides,
  };
}

function queries(seed: {
  people?: Person[];
  memories?: Memory[];
  householdMemberships?: HouseholdMembership[];
  householdRecordShares?: HouseholdRecordShare[];
}) {
  return createRelationshipContextSearchQueries(createInMemoryRelationshipContextSearchStore(seed));
}

describe("relationship-context search - memory results", () => {
  it("applies household visibility before returning memory exact-recall results", async () => {
    const householdId = "99999999-9999-4999-8999-999999999999";
    const sharedMemoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const householdMemoryId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const removedMemoryId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const search = queries({
      people: [
        person({ ownerUserId: "owner-1" }),
        person({ id: noahId, ownerUserId: "member-1", displayName: "Noah Kim" }),
      ],
      memories: [
        memory({ content: "private kayaking plan" }),
        memory({
          id: sharedMemoryId,
          content: "shared kayaking plan",
          scope: "shared",
          householdId,
        }),
        memory({
          id: householdMemoryId,
          content: "household kayaking plan",
          scope: "household",
          householdId,
        }),
        memory({
          id: removedMemoryId,
          content: "removed kayaking plan",
          scope: "shared",
          householdId,
        }),
      ],
      householdMemberships: [
        householdMembership({ householdId, userId: "owner-1", role: "owner" }),
        householdMembership({ householdId, userId: "member-1" }),
        householdMembership({ householdId, userId: "removed-1", status: "removed" }),
      ],
      householdRecordShares: [
        householdRecordShare({
          householdId,
          recordId: sharedMemoryId,
          sharedWithUserId: "member-1",
        }),
        householdRecordShare({
          householdId,
          recordId: removedMemoryId,
          sharedWithUserId: "removed-1",
        }),
      ],
    });

    const activeMemberResults = await search.searchRelationshipContext({
      ownerUserId: "member-1",
      query: "kayaking",
      recordKinds: ["memory"],
      limit: 10,
      directlyRequested: true,
    });
    expect(activeMemberResults.map((result) => result.recordId).sort()).toEqual(
      [householdMemoryId, sharedMemoryId].sort(),
    );
    expect(activeMemberResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordId: sharedMemoryId, visibilityLabel: "Specific people" }),
        expect.objectContaining({
          recordId: householdMemoryId,
          visibilityLabel: "Whole household",
        }),
      ]),
    );

    await expect(
      search.searchRelationshipContext({
        ownerUserId: "removed-1",
        query: "kayaking",
        recordKinds: ["memory"],
        limit: 10,
        directlyRequested: true,
      }),
    ).resolves.toEqual([]);
  });

  /**
   * Scope alone does not make a memory shared: a `shared` or `household` row reaches its
   * audience through its household, and a row that names a non-private scope without one is
   * anchored to nothing. Recall fails closed on it, so it answers nobody - not even the
   * owner who wrote it, who goes on seeing it on the person's page and cannot understand
   * why their own search has never heard of it.
   */
  it("returns an owner's shared memory only once it is anchored to their household", async () => {
    const householdId = "99999999-9999-4999-8999-999999999999";
    const anchoredId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const unanchoredId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const search = queries({
      people: [person({})],
      memories: [
        memory({ id: anchoredId, content: "anchored kayaking plan", scope: "shared", householdId }),
        memory({
          id: unanchoredId,
          content: "unanchored kayaking plan",
          scope: "shared",
          householdId: null,
        }),
      ],
      householdMemberships: [
        householdMembership({ householdId, userId: "owner-1", role: "owner" }),
      ],
    });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "kayaking",
      recordKinds: ["memory"],
      limit: 10,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([anchoredId]);
    expect(results[0]?.visibilityLabel).toBe("Specific people");
  });

  it("returns approved memories as confirmed exact-recall results with person metadata", async () => {
    const search = queries({ people: [person({})], memories: [memory({})] });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      recordKinds: ["memory"],
      limit: 10,
      directlyRequested: false,
    });

    expect(results).toEqual([
      expect.objectContaining({
        recordKind: "memory",
        recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        relatedPersonId: maraId,
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Mara prefers backend architecture conversations in Nashville.",
        matchedFields: ["content"],
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
      }),
    ]);
  });

  it("includes approved memories in the default normal recall path", async () => {
    const search = queries({ people: [person({})], memories: [memory({})] });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      limit: 10,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordKind)).toContain("memory");
  });

  it("excludes suggested, dismissed, archived, other-owner, and restricted memories by default", async () => {
    const search = queries({
      people: [person({})],
      memories: [
        memory({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "suggested" }),
        memory({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "dismissed" }),
        memory({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "archived" }),
        memory({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          ownerUserId: "owner-2",
          status: "approved",
        }),
        memory({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          status: "approved",
          sensitivity: "restricted",
        }),
      ],
    });

    await expect(
      search.searchRelationshipContext({
        ownerUserId: "owner-1",
        query: "backend",
        recordKinds: ["memory"],
        limit: 10,
        directlyRequested: false,
      }),
    ).resolves.toEqual([]);
  });

  it("returns restricted approved memories only when directly requested", async () => {
    const search = queries({
      people: [person({})],
      memories: [memory({ sensitivity: "restricted" })],
    });

    const hidden = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      recordKinds: ["memory"],
      limit: 10,
      directlyRequested: false,
    });
    const direct = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      recordKinds: ["memory"],
      limit: 10,
      directlyRequested: true,
    });

    expect(hidden).toEqual([]);
    expect(direct).toHaveLength(1);
    expect(direct[0]?.sensitivity).toBe("restricted");
  });

  it("supports person filters, limits, snippets, and mixed owner isolation for memories", async () => {
    const search = queries({
      people: [person({ id: maraId }), person({ id: noahId, displayName: "Noah Kim" })],
      memories: [
        memory({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          personId: maraId,
          importance: 5,
          content: `Mara mentioned backend systems. ${"Detailed note. ".repeat(20)}`,
        }),
        memory({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          personId: noahId,
          content: "Noah mentioned backend systems.",
        }),
      ],
    });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      personId: maraId,
      recordKinds: ["memory"],
      limit: 1,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
    expect(results[0]?.snippet.length).toBeLessThanOrEqual(160);
  });

  it("ranks stronger text matches ahead of higher-importance weak matches", async () => {
    const search = queries({
      people: [person({})],
      memories: [
        memory({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          content: "Mara mentioned backend architecture and backend systems.",
          importance: 1,
        }),
        memory({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          content: "Mara mentioned architecture notes for backend work.",
          importance: 5,
        }),
      ],
    });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend architecture",
      recordKinds: ["memory"],
      limit: 2,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
  });
});
