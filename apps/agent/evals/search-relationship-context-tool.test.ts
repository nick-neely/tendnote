import { describe, expect, it, vi } from "vitest";

const { searchRelationshipContext } = vi.hoisted(() => ({
  searchRelationshipContext: vi.fn(),
}));

vi.mock("@tendnote/db/queries/relationship-context-search", () => ({
  searchRelationshipContext,
}));

const { default: tool } = await import("../agent/tools/search_relationship_context");

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

describe("search_relationship_context tool", () => {
  it("calls the shared owner-scoped exact recall query", async () => {
    searchRelationshipContext.mockResolvedValue([
      {
        recordKind: "person",
        recordId: "person-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Talked about backend architecture.",
        matchedFields: ["profileBlurb"],
        rank: 1.2,
        trustLevel: "identity_reference",
        sensitivity: "normal",
      },
    ]);

    const result = await tool.execute(
      { query: "backend", limit: 5, directlyRequested: false },
      ctx,
    );

    expect(searchRelationshipContext).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      query: "backend",
      limit: 5,
      directlyRequested: false,
    });
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        recordKind: "person",
        recordId: "person-1",
        snippet: "Talked about backend architecture.",
        trustLevel: "identity_reference",
      }),
    );
    expect(result).not.toHaveProperty("person");
    expect(result).not.toHaveProperty("snapshot");
  });

  it("forwards direct restricted requests without using search_people", async () => {
    searchRelationshipContext.mockResolvedValue([]);

    await tool.execute(
      {
        query: "delicate",
        recordKinds: ["person"],
        limit: 3,
        directlyRequested: true,
      },
      ctx,
    );

    expect(searchRelationshipContext).toHaveBeenLastCalledWith({
      ownerUserId: "user-1",
      query: "delicate",
      recordKinds: ["person"],
      limit: 3,
      directlyRequested: true,
    });
  });
});
