import type { Person } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryRelationshipContextSearchStore } from "./in-memory-store";
import { createRelationshipContextSearchQueries } from "./queries";

const now = new Date("2026-06-26T00:00:00Z");

function person(overrides: Partial<Person>): Person {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner-1",
    displayName: "Mara Lin",
    firstName: "Mara",
    lastName: "Lin",
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: "Talked about backend architecture and Nashville.",
    source: "manual",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function queries(seed: Person[]) {
  return createRelationshipContextSearchQueries(
    createInMemoryRelationshipContextSearchStore({ people: seed }),
  );
}

describe("relationship-context search - person results", () => {
  it("returns compact person exact-recall references scoped to one owner", async () => {
    const search = queries([
      person({ id: "11111111-1111-4111-8111-111111111111", ownerUserId: "owner-1" }),
      person({
        id: "22222222-2222-4222-8222-222222222222",
        ownerUserId: "owner-2",
        displayName: "Mara Other",
      }),
    ]);

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      limit: 10,
      directlyRequested: false,
    });

    expect(results).toEqual([
      {
        recordKind: "person",
        recordId: "11111111-1111-4111-8111-111111111111",
        relatedPersonId: "11111111-1111-4111-8111-111111111111",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Talked about backend architecture and Nashville.",
        matchedFields: ["profileBlurb"],
        rank: expect.any(Number),
        trustLevel: "identity_reference",
        sensitivity: "normal",
      },
    ]);
  });

  it("honors record-kind filters and excludes person search when filtered out", async () => {
    const search = queries([person({})]);

    await expect(
      search.searchRelationshipContext({
        ownerUserId: "owner-1",
        query: "Mara",
        recordKinds: ["memory"],
        limit: 10,
        directlyRequested: false,
      }),
    ).resolves.toEqual([]);
  });

  it("applies the limit across person results with deterministic ordering", async () => {
    const search = queries([
      person({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        displayName: "B Mara",
        profileBlurb: null,
      }),
      person({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        displayName: "A Mara",
        profileBlurb: null,
      }),
    ]);

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "Mara",
      limit: 1,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
  });

  it("does not return a generic person hit when a specific person filter is requested", async () => {
    const search = queries([
      person({ id: "11111111-1111-4111-8111-111111111111" }),
      person({ id: "22222222-2222-4222-8222-222222222222", displayName: "Mara Other" }),
    ]);

    const results = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "Mara",
      personId: "11111111-1111-4111-8111-111111111111",
      limit: 10,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("keeps long person snippets concise", async () => {
    const search = queries([
      person({
        profileBlurb: `Mara talked about backend architecture. ${"Long context. ".repeat(20)}`,
      }),
    ]);

    const [result] = await search.searchRelationshipContext({
      ownerUserId: "owner-1",
      query: "backend",
      limit: 10,
      directlyRequested: false,
    });

    expect(result?.snippet.length).toBeLessThanOrEqual(160);
  });
});
