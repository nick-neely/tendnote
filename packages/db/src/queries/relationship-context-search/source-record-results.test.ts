import type {
  HouseholdMembership,
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

function sourceRecord(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    id: sourceId,
    ownerUserId: "owner-1",
    sourceType: "manual",
    content: "Logged lunch with Mara about backend architecture in Nashville.",
    rawContent: "RAW SECRET PROVIDER TEXT",
    retentionPolicy: "retain",
    status: "active",
    confidence: "medium",
    sensitivity: "normal",
    scope: "private",
    householdId: null,
    importance: 3,
    metadataJson: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function link(overrides: Partial<SourceRecordPerson>): SourceRecordPerson {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    sourceRecordId: sourceId,
    personId: maraId,
    role: "mentioned",
    createdAt: now,
    ...overrides,
  };
}

function queries(seed: {
  people?: Person[];
  sourceRecords?: SourceRecord[];
  sourceRecordPeople?: SourceRecordPerson[];
  householdMemberships?: HouseholdMembership[];
  householdRecordShares?: HouseholdRecordShare[];
}) {
  return createRelationshipContextSearchQueries(createInMemoryRelationshipContextSearchStore(seed));
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
    recordKind: "source_record",
    recordId: sourceId,
    sharedWithUserId: "member-1",
    sharedByUserId: "owner-1",
    createdAt: now,
    ...overrides,
  };
}

describe("relationship-context search - source-record results", () => {
  it("applies household visibility before returning source-record exact recall results", async () => {
    const householdId = "99999999-9999-4999-8999-999999999999";
    const sharedRecordId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const householdRecordId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const removedRecordId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const search = queries({
      sourceRecords: [
        sourceRecord({ content: "private pottery note" }),
        sourceRecord({
          id: sharedRecordId,
          content: "shared pottery note",
          scope: "shared",
          householdId,
        }),
        sourceRecord({
          id: householdRecordId,
          content: "household pottery note",
          scope: "household",
          householdId,
        }),
        sourceRecord({
          id: removedRecordId,
          content: "removed pottery note",
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
          recordId: sharedRecordId,
          sharedWithUserId: "member-1",
        }),
        householdRecordShare({
          householdId,
          recordId: removedRecordId,
          sharedWithUserId: "removed-1",
        }),
      ],
    });

    const activeMemberResults = await search.searchRelationshipContext({
      ownerUserId: "member-1",
      query: "pottery",
      recordKinds: ["source_record"],
      limit: 10,
      directlyRequested: true,
    });
    expect(activeMemberResults.map((result) => result.recordId).sort()).toEqual(
      [householdRecordId, sharedRecordId].sort(),
    );
    expect(activeMemberResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordId: sharedRecordId, visibilityLabel: "Specific people" }),
        expect.objectContaining({
          recordId: householdRecordId,
          visibilityLabel: "Whole household",
        }),
      ]),
    );

    await expect(
      search.searchRelationshipContext({
        ownerUserId: "removed-1",
        query: "pottery",
        recordKinds: ["source_record"],
        limit: 10,
        directlyRequested: true,
      }),
    ).resolves.toEqual([]);
  });

  it("returns active source records as logged-context exact recall results", async () => {
    const search = queries({
      people: [person({})],
      sourceRecords: [sourceRecord({})],
      sourceRecordPeople: [link({})],
    });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      recordKinds: ["source_record"],
      limit: 10,
      directlyRequested: false,
    });

    expect(results).toEqual([
      expect.objectContaining({
        recordKind: "source_record",
        recordId: sourceId,
        relatedPersonId: maraId,
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Logged lunch with Mara about backend architecture in Nashville.",
        matchedFields: ["content"],
        trustLevel: "logged_context",
        sensitivity: "normal",
      }),
    ]);
  });

  it("excludes pending, dismissed, archived, other-owner, and restricted records by default", async () => {
    const search = queries({
      sourceRecords: [
        sourceRecord({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "pending_resolution" }),
        sourceRecord({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "dismissed" }),
        sourceRecord({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "archived" }),
        sourceRecord({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          ownerUserId: "owner-2",
        }),
        sourceRecord({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          sensitivity: "restricted",
        }),
      ],
    });

    await expect(
      search.searchRelationshipContext({
        ownerUserId: "owner-1",
        query: "backend",
        recordKinds: ["source_record"],
        limit: 10,
        directlyRequested: false,
      }),
    ).resolves.toEqual([]);
  });

  it("returns restricted active source records only when directly requested", async () => {
    const search = queries({ sourceRecords: [sourceRecord({ sensitivity: "restricted" })] });

    const hidden = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      recordKinds: ["source_record"],
      limit: 10,
      directlyRequested: false,
    });
    const direct = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      recordKinds: ["source_record"],
      limit: 10,
      directlyRequested: true,
    });

    expect(hidden).toEqual([]);
    expect(direct).toHaveLength(1);
    expect(direct[0]?.sensitivity).toBe("restricted");
  });

  it("searches retained content instead of raw content", async () => {
    const search = queries({
      sourceRecords: [
        sourceRecord({
          content: "Retained note about lunch.",
          rawContent: "backend architecture",
        }),
      ],
    });

    await expect(
      search.searchRelationshipContext({
        ownerUserId: "owner-1",
        query: "backend",
        recordKinds: ["source_record"],
        limit: 10,
        directlyRequested: false,
      }),
    ).resolves.toEqual([]);
  });

  it("supports person filters, limits, snippets, and default normal recall", async () => {
    const search = queries({
      people: [person({})],
      sourceRecords: [
        sourceRecord({
          id: sourceId,
          content: `Mara mentioned backend systems. ${"Detailed note. ".repeat(20)}`,
        }),
        sourceRecord({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          content: "Unlinked backend note.",
        }),
      ],
      sourceRecordPeople: [link({ sourceRecordId: sourceId })],
    });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      personId: maraId,
      limit: 1,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([sourceId]);
    expect(results[0]?.snippet.length).toBeLessThanOrEqual(160);
  });

  it("returns one owner-scoped source-record reference for multi-person links", async () => {
    const noahId = "22222222-2222-4222-8222-222222222222";
    const search = queries({
      people: [
        person({ id: maraId, displayName: "Mara Lin", ownerUserId: "owner-1" }),
        person({ id: noahId, displayName: "Noah Kim", ownerUserId: "owner-1" }),
        person({
          id: "33333333-3333-4333-8333-333333333333",
          displayName: "Other Owner",
          ownerUserId: "owner-2",
        }),
      ],
      sourceRecords: [sourceRecord({})],
      sourceRecordPeople: [
        link({ personId: maraId, role: "mentioned" }),
        link({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          personId: noahId,
          role: "primary",
        }),
        link({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          personId: "33333333-3333-4333-8333-333333333333",
          role: "mentioned",
        }),
      ],
    });

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      recordKinds: ["source_record"],
      limit: 10,
      directlyRequested: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.recordId).toBe(sourceId);
    expect(results[0]?.relatedPersonId).toBe(maraId);
    expect(results[0]?.relatedPersonId).not.toBe("33333333-3333-4333-8333-333333333333");
  });
});
