import { describe, expect, it, vi } from "vitest";

const { searchRelationshipContext } = vi.hoisted(() => ({
  searchRelationshipContext: vi.fn(),
}));

vi.mock("@tendnote/db/queries/relationship-context-search", () => ({
  searchRelationshipContext,
}));

const { default: tool } = await import("../tools/search_relationship_context");

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

  it("returns compact typed references without full profiles or snapshot prose", async () => {
    searchRelationshipContext.mockResolvedValue([
      {
        recordKind: "memory",
        recordId: "memory-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Mara prefers backend architecture conversations.",
        matchedFields: ["content"],
        rank: 1.1,
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        fullProfile: "Do not expose full profiles through exact recall.",
        snapshot: { summary: "Generated snapshot prose must not become recall truth." },
      },
      {
        recordKind: "source_record",
        recordId: "source-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Logged lunch about backend architecture.",
        matchedFields: ["content"],
        rank: 0.9,
        trustLevel: "logged_context",
        sensitivity: "normal",
        snapshotStatus: "fresh",
      },
    ]);

    const result = await tool.execute(
      { query: "backend architecture", limit: 5, directlyRequested: false },
      ctx,
    );

    expect(result.results).toEqual([
      {
        recordKind: "memory",
        recordId: "memory-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Mara prefers backend architecture conversations.",
        matchedFields: ["content"],
        rank: 1.1,
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
      },
      {
        recordKind: "source_record",
        recordId: "source-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        label: "Mara Lin",
        snippet: "Logged lunch about backend architecture.",
        matchedFields: ["content"],
        rank: 0.9,
        trustLevel: "logged_context",
        sensitivity: "normal",
      },
    ]);
    expect(result).not.toHaveProperty("person");
    expect(result).not.toHaveProperty("profile");
    expect(result).not.toHaveProperty("snapshot");
    expect(JSON.stringify(result)).not.toContain("snapshotStatus");
  });

  it("keeps exact recall distinct from identity lookup and context loading", async () => {
    searchRelationshipContext.mockResolvedValue([]);

    await tool.execute(
      {
        query: "backend",
        recordKinds: ["person", "memory", "source_record"],
        limit: 8,
        directlyRequested: false,
      },
      ctx,
    );

    expect(searchRelationshipContext).toHaveBeenLastCalledWith({
      ownerUserId: "user-1",
      query: "backend",
      recordKinds: ["person", "memory", "source_record"],
      limit: 8,
      directlyRequested: false,
    });
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
