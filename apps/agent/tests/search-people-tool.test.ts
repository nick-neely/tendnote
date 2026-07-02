import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchPeople } = vi.hoisted(() => ({ searchPeople: vi.fn() }));

vi.mock("@tendnote/db/queries/people", () => ({ searchPeople }));

const { default: tool } = await import("../agent/tools/search_people");

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

beforeEach(() => {
  searchPeople.mockReset();
});

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

  it("retries a name query without a guessed relationshipType when the filtered search is empty", async () => {
    // The model guessed "other" for a friend named Alex; the typed search finds
    // nothing, so the tool must retry by name alone and still surface the person.
    searchPeople.mockResolvedValueOnce([]).mockResolvedValueOnce([person("p1", "Alex Morgan")]);

    const result = await tool.execute({ query: "Alex", relationshipType: "other", limit: 10 }, ctx);

    expect(searchPeople).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ query: "Alex", relationshipType: "other", ownerUserId: "user-1" }),
    );
    expect(searchPeople).toHaveBeenNthCalledWith(2, {
      query: "Alex",
      limit: 10,
      ownerUserId: "user-1",
    });
    expect(searchPeople).toHaveBeenCalledTimes(2);
    expect(result.people).toEqual([
      expect.objectContaining({ id: "p1", displayName: "Alex Morgan" }),
    ]);
  });

  it("does not retry when a name query has no relationshipType filter", async () => {
    searchPeople.mockResolvedValue([]);

    const result = await tool.execute({ query: "Nobody", limit: 10 }, ctx);

    expect(searchPeople).toHaveBeenCalledTimes(1);
    expect(result.people).toEqual([]);
  });
});
