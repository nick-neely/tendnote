import { describe, expect, it } from "vitest";
import { aggregateArtifactScope, normalizeItemScope } from "./scheduled-workflow-artifact-scope";

describe("aggregateArtifactScope", () => {
  it("fails closed to private for an empty artifact (no household to key on)", () => {
    expect(aggregateArtifactScope([])).toEqual({ scope: "private", householdId: null });
  });

  it("carries the household when every item is household-visible for the same household", () => {
    expect(
      aggregateArtifactScope([
        { scope: "household", householdId: "h1" },
        { scope: "household", householdId: "h1" },
      ]),
    ).toEqual({ scope: "household", householdId: "h1" });
  });

  it("fails closed to private when any item is private", () => {
    expect(
      aggregateArtifactScope([
        { scope: "household", householdId: "h1" },
        { scope: "private", householdId: null },
      ]),
    ).toEqual({ scope: "private", householdId: null });
  });

  it("fails closed to private when any item has an unknown (omitted) scope", () => {
    expect(aggregateArtifactScope([{ scope: "household", householdId: "h1" }, {}])).toEqual({
      scope: "private",
      householdId: null,
    });
  });

  it("fails closed to private when any item is shared (selected-members)", () => {
    expect(
      aggregateArtifactScope([
        { scope: "household", householdId: "h1" },
        { scope: "shared", householdId: "h1" },
      ]),
    ).toEqual({ scope: "private", householdId: null });
  });

  it("fails closed to private when household items span two different households", () => {
    expect(
      aggregateArtifactScope([
        { scope: "household", householdId: "h1" },
        { scope: "household", householdId: "h2" },
      ]),
    ).toEqual({ scope: "private", householdId: null });
  });

  it("fails closed to private for a household item missing its household id", () => {
    expect(aggregateArtifactScope([{ scope: "household", householdId: null }])).toEqual({
      scope: "private",
      householdId: null,
    });
  });
});

describe("normalizeItemScope", () => {
  it("defaults an omitted scope to private", () => {
    expect(normalizeItemScope({})).toEqual({ scope: "private", householdId: null });
  });

  it("retains the household id only for a household scope", () => {
    expect(normalizeItemScope({ scope: "household", householdId: "h1" })).toEqual({
      scope: "household",
      householdId: "h1",
    });
  });

  it("drops a stray household id on a non-household scope so it cannot leak", () => {
    expect(normalizeItemScope({ scope: "private", householdId: "h1" })).toEqual({
      scope: "private",
      householdId: null,
    });
    expect(normalizeItemScope({ scope: "shared", householdId: "h1" })).toEqual({
      scope: "shared",
      householdId: null,
    });
  });
});
