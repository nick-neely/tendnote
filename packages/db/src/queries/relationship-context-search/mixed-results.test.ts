import type {
  HouseholdMembership,
  Memory,
  Person,
  SourceRecord,
  SourceRecordPerson,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import type { HouseholdRecordShare } from "../households/types";
import { createInMemoryRelationshipContextSearchStore } from "./in-memory-store";
import { createRelationshipContextSearchQueries } from "./queries";

const now = new Date("2026-06-26T00:00:00Z");
const maraId = "11111111-1111-4111-8111-111111111111";
const sourceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    profileBlurb: "Mara talks about backend architecture.",
    source: "manual",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function memory(overrides: Partial<Memory>): Memory {
  return {
    id: memoryId,
    personId: maraId,
    ownerUserId: "owner-1",
    sourceRecordId: sourceId,
    memoryType: "context",
    content: "Mara has a confirmed backend architecture preference.",
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

function sourceRecord(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    id: sourceId,
    ownerUserId: "owner-1",
    sourceType: "manual",
    content: "Logged backend architecture note from lunch.",
    rawContent: null,
    retentionPolicy: "retain",
    status: "active",
    confidence: "medium",
    sensitivity: "normal",
    scope: "private",
    importance: 3,
    metadataJson: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function link(overrides: Partial<SourceRecordPerson>): SourceRecordPerson {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sourceRecordId: sourceId,
    personId: maraId,
    role: "mentioned",
    createdAt: now,
    ...overrides,
  };
}

function activeMembership(overrides: Partial<HouseholdMembership>): HouseholdMembership {
  return {
    id: `membership-${overrides.userId ?? "user"}`,
    householdId: "household-1",
    userId: "owner-1",
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

function householdShare(overrides: Partial<HouseholdRecordShare>): HouseholdRecordShare {
  return {
    id: `share-${overrides.recordId ?? "record"}`,
    householdId: "household-1",
    recordKind: "memory",
    recordId: memoryId,
    sharedWithUserId: "owner-1",
    sharedByUserId: "member-1",
    createdAt: now,
    ...overrides,
  };
}

function queries(seed: {
  people?: Person[];
  memories?: Memory[];
  sourceRecords?: SourceRecord[];
  sourceRecordPeople?: SourceRecordPerson[];
  householdMemberships?: HouseholdMembership[];
  householdRecordShares?: HouseholdRecordShare[];
}) {
  return createRelationshipContextSearchQueries(createInMemoryRelationshipContextSearchStore(seed));
}

describe("relationship-context search - mixed results", () => {
  it("returns all supported result kinds through one owner-scoped contract", async () => {
    const search = queries({
      people: [person({})],
      memories: [memory({})],
      sourceRecords: [sourceRecord({})],
      sourceRecordPeople: [link({})],
    });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      limit: 10,
      directlyRequested: false,
    });

    expect(new Set(results.map((result) => result.recordKind))).toEqual(
      new Set(["person", "memory", "source_record"]),
    );
  });

  it("applies kind filters, person filters, and limits across the mixed result set", async () => {
    const otherPersonId = "22222222-2222-4222-8222-222222222222";
    const search = queries({
      people: [person({}), person({ id: otherPersonId, displayName: "Noah Kim" })],
      memories: [
        memory({ id: memoryId, personId: maraId }),
        memory({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          personId: otherPersonId,
          content: "Noah mentioned backend architecture.",
        }),
      ],
      sourceRecords: [sourceRecord({})],
      sourceRecordPeople: [link({})],
    });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      personId: maraId,
      recordKinds: ["memory", "source_record"],
      limit: 1,
      directlyRequested: false,
    });

    expect(results).toHaveLength(1);
    expect(["memory", "source_record"]).toContain(results[0]?.recordKind);
    expect(results[0]?.relatedPersonId).toBe(maraId);
  });

  it("applies direct restricted retrieval consistently for memories and source records", async () => {
    const search = queries({
      people: [person({})],
      memories: [memory({ sensitivity: "restricted" })],
      sourceRecords: [sourceRecord({ sensitivity: "restricted" })],
      sourceRecordPeople: [link({})],
    });

    const hidden = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      recordKinds: ["memory", "source_record"],
      limit: 10,
      directlyRequested: false,
    });
    const direct = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      recordKinds: ["memory", "source_record"],
      limit: 10,
      directlyRequested: true,
    });

    expect(hidden).toEqual([]);
    expect(new Set(direct.map((result) => result.recordKind))).toEqual(
      new Set(["memory", "source_record"]),
    );
  });

  it("enforces household visibility before returning exact recall results", async () => {
    const privateMemberMemory = memory({
      id: "33333333-3333-4333-8333-333333333333",
      ownerUserId: "member-1",
      content: "Mara has a private backend architecture note.",
      scope: "private",
    });
    const sharedMemberMemory = memory({
      id: "44444444-4444-4444-8444-444444444444",
      ownerUserId: "member-1",
      content: "Mara shared a backend architecture note.",
      scope: "shared",
      householdId: "household-1",
    });
    const householdMemberSource = sourceRecord({
      id: "55555555-5555-4555-8555-555555555555",
      ownerUserId: "member-1",
      content: "Household backend architecture note.",
      scope: "household",
      householdId: "household-1",
    });
    const removedMemberSource = sourceRecord({
      id: "66666666-6666-4666-8666-666666666666",
      ownerUserId: "member-2",
      content: "Removed backend architecture note.",
      scope: "household",
      householdId: "household-2",
    });
    const search = queries({
      people: [
        person({}),
        person({ id: "77777777-7777-4777-8777-777777777777", ownerUserId: "member-1" }),
      ],
      memories: [privateMemberMemory, sharedMemberMemory],
      sourceRecords: [householdMemberSource, removedMemberSource],
      householdMemberships: [
        activeMembership({ householdId: "household-1", userId: "owner-1" }),
        activeMembership({ householdId: "household-1", userId: "member-1" }),
        activeMembership({ householdId: "household-2", userId: "member-2", status: "removed" }),
      ],
      householdRecordShares: [
        householdShare({ recordKind: "memory", recordId: sharedMemberMemory.id }),
      ],
    });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend architecture note",
      recordKinds: ["memory", "source_record"],
      limit: 10,
      directlyRequested: true,
    });

    expect(results.map((result) => result.recordId).sort()).toEqual(
      [sharedMemberMemory.id, householdMemberSource.id].sort(),
    );
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordId: sharedMemberMemory.id,
          ownerUserId: "member-1",
          scope: "shared",
          householdId: "household-1",
        }),
        expect.objectContaining({
          recordId: householdMemberSource.id,
          ownerUserId: "member-1",
          scope: "household",
          householdId: "household-1",
        }),
      ]),
    );
  });

  it("keeps text strength ahead of importance tie-breakers", async () => {
    const search = queries({
      people: [person({ profileBlurb: null })],
      memories: [
        memory({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          content: "Mara mentioned backend architecture and backend systems.",
          importance: 1,
        }),
        memory({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
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
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    ]);
  });

  it("uses recency as a light tie-breaker after matching strength", async () => {
    const search = queries({
      people: [person({ profileBlurb: null })],
      memories: [
        memory({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          content: "Mara mentioned backend systems.",
          updatedAt: new Date("2026-06-01T00:00:00Z"),
        }),
        memory({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          content: "Mara mentioned backend systems.",
          updatedAt: new Date("2026-06-20T00:00:00Z"),
        }),
      ],
    });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      recordKinds: ["memory"],
      limit: 2,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ]);
  });

  it("does not leak cross-owner records into mixed results", async () => {
    const search = queries({
      people: [person({ ownerUserId: "owner-2" })],
      memories: [memory({ ownerUserId: "owner-2" })],
      sourceRecords: [sourceRecord({ ownerUserId: "owner-2" })],
      sourceRecordPeople: [link({})],
    });

    await expect(
      search.searchRelationshipContext({
        ownerUserId: "owner-1",
        query: "backend",
        limit: 10,
        directlyRequested: true,
      }),
    ).resolves.toEqual([]);
  });
});
