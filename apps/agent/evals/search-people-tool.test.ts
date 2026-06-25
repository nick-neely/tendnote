import { describe, expect, it, vi } from "vitest";

const { searchPeople } = vi.hoisted(() => ({ searchPeople: vi.fn() }));

vi.mock("@tendnote/db", () => ({ searchPeople }));

const { default: tool } = await import("../agent/tools/search_people");

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

function person(id: string, displayName: string) {
  return {
    id,
    displayName,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
  };
}

describe("search_people tool (disambiguation signal)", () => {
  it("flags disambiguation when a name matches more than one person", async () => {
    searchPeople.mockResolvedValue([person("p1", "Sam Lee"), person("p2", "Sam Lee")]);

    const result = await tool.execute({ query: "Sam", limit: 10 }, ctx);

    expect(searchPeople).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user-1", query: "Sam", limit: 10 }),
    );
    expect(result.people).toHaveLength(2);
    expect(result.requiresDisambiguation).toBe(true);
  });

  it("does not require disambiguation for a single confident match", async () => {
    searchPeople.mockResolvedValue([person("p1", "Sam Lee")]);

    const result = await tool.execute({ query: "Sam", limit: 10 }, ctx);

    expect(result.requiresDisambiguation).toBe(false);
  });

  it("does not require disambiguation when no one matches", async () => {
    searchPeople.mockResolvedValue([]);

    const result = await tool.execute({ query: "Nobody", limit: 10 }, ctx);

    expect(result.people).toEqual([]);
    expect(result.requiresDisambiguation).toBe(false);
  });
});
