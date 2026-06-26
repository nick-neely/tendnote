import type { Memory, Person } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
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

function queries(seed: { people?: Person[]; memories?: Memory[] }) {
  return createRelationshipContextSearchQueries(createInMemoryRelationshipContextSearchStore(seed));
}

describe("relationship-context search - memory results", () => {
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
