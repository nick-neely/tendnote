import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNoopHouseholdScheduledWorkStore } from "./scheduled-work";

const source = readFileSync(join(import.meta.dirname, "scheduled-work.ts"), "utf8");

/**
 * The departure sweep is raw update statements against seven tables, so what is
 * worth pinning is not that they run - governance's own suite covers that - but
 * the three narrowings that decide whether a departure leaks, strands, or breaks
 * a record. Each of them is one clause, and each has a specific wrong answer.
 */
describe("the member-owned revert narrows every family the same way", () => {
  it.each([
    ["savedItems", "saved item"],
    ["generalActions", "action"],
  ])("keeps the workspace's own %s out of the sweep", (table) => {
    // Without the ownership filter a household-native record would follow its
    // creator out of the household it belongs to (ADR 0214).
    expect(source).toContain(`eq(${table}.ownership, "member_owned")`);
  });

  it("moves only this owner's non-private rows in this household", () => {
    // Memories and Follow-Ups narrow identically, so they share one clause
    // builder rather than two copies that could drift apart by a filter.
    expect(source).toContain("eq(table.householdId, input.householdId)");
    expect(source).toContain("eq(table.ownerUserId, input.ownerUserId)");
    expect(source).toContain('ne(table.scope, "private")');
    expect(source).toContain(".where(ownRowsInThisHousehold(memories))");
    expect(source).toContain(".where(ownRowsInThisHousehold(followups))");
    for (const table of ["savedItems", "sourceRecords"]) {
      expect(source).toContain(`eq(${table}.householdId, input.householdId)`);
      expect(source).toContain(`eq(${table}.ownerUserId, input.ownerUserId)`);
      expect(source).toContain(`ne(${table}.scope, "private")`);
    }
  });

  it("bumps the Saved Item concurrency fence, because the revert is a write", () => {
    expect(source).toMatch(/version: sql`\$\{savedItems\.version} \+ 1`/);
  });

  /**
   * The one exclusion in the sweep, and the one that fails silently if it is
   * wrong: a household-native record keeps its capturing member in
   * `owner_user_id`, so the owner match alone would take the grounding of a
   * record that survives the departure private with the person who left.
   */
  it("leaves behind the evidence the household's own records stand on", () => {
    for (const family of ["savedItems", "generalActions", "assetMemories", "assetEvidence"]) {
      expect(source).toContain(`eq(${family}.sourceRecordId, sourceRecords.id)`);
      expect(source).toContain(`eq(${family}.ownership, "household_native")`);
    }
    expect(source).toMatch(/sql`not \(\$\{groundsSurvivingHouseholdRecord}\)`/);
  });
});

describe("the inert store", () => {
  it("answers every effect with nothing, so a composition with no scheduled work still ends", async () => {
    const store = createNoopHouseholdScheduledWorkStore();
    const scope = { householdId: "household", ownerUserId: "member", userId: "member" };

    await expect(store.revertMemberOwnedSavedItemsToPrivate(scope)).resolves.toEqual([]);
    await expect(store.revertMemberOwnedRelationshipRecordsToPrivate(scope)).resolves.toEqual({
      memories: [],
      sourceRecords: [],
      followups: [],
    });
  });
});
