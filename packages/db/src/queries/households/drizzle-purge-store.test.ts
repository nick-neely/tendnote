import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "drizzle-purge-store.ts"), "utf8");
const savedItemsSchema = readFileSync(
  join(import.meta.dirname, "../../schema/app/saved-items.ts"),
  "utf8",
);

/**
 * Whitespace removed from both haystack and needle, so a formatter reflowing a
 * long call across lines cannot fail a test that is about deletion order.
 */
const compact = source.replace(/\s+/g, "");
const squash = (marker: string) => marker.replace(/\s+/g, "");

/** Where a marker first appears, so relative order can be asserted as a fact. */
function at(marker: string): number {
  const index = compact.indexOf(squash(marker));
  expect(index, `expected the purge store to contain ${marker}`).toBeGreaterThan(-1);
  return index;
}

function pins(marker: string) {
  expect(compact, `expected the purge store to contain ${marker}`).toContain(squash(marker));
}

/**
 * The purge is a sequence of deletes whose *order* is the whole contract. Every
 * one of the orderings below has a specific wrong answer with a specific
 * consequence, and none of them is visible in a type or caught by a lint.
 */
describe("the purge disposes of a household in the one order its constraints allow", () => {
  it("clears household-native Saved Items before the workspace row they check against", () => {
    // The trap this sweep exists to survive. `household_id` is `set null` and
    // `saved_items_ownership_check` forbids a household-native row without a
    // household, so deleting the workspace first does not orphan the item - it
    // aborts the transaction on a check violation.
    expect(savedItemsSchema).toContain("saved_items_ownership_check");
    expect(savedItemsSchema).toContain('onDelete: "set null"');
    expect(at("inArray(savedItems.id, savedItemIds)")).toBeLessThan(
      at("delete(householdWorkspaces)"),
    );
  });

  it("cancels reminders while the records they name still exist", () => {
    // `reminder_schedules.record_id` is a bare uuid: a Saved Item's schedules
    // have no foreign key to follow, so once the item is deleted there is
    // nothing left to find them by.
    expect(at("cancelRemindersForRecords")).toBeLessThan(
      at("inArray(savedItems.id, savedItemIds)"),
    );
    expect(at("const savedItemIds")).toBeLessThan(at("cancelRemindersForRecords"));
  });

  it("removes Asset children before the Assets they hang off", () => {
    expect(at("deleteReturning(tx, assetEvidence")).toBeLessThan(at("deleteReturning(tx, assets,"));
    expect(at("deleteReturning(tx, assetMemories")).toBeLessThan(at("deleteReturning(tx, assets,"));
  });

  it("releases Source Records only after the household records grounded on them are gone", () => {
    // The mirror of the departure sweep's one exclusion: dissolution held these
    // back so the workspace's own record stayed readable. They come home once
    // that record does not exist to be grounded.
    expect(at("inArray(savedItems.id, savedItemIds)")).toBeLessThan(
      at("releaseMemberOwnedRecords"),
    );
    expect(at("releaseSimple(sourceRecords)")).toBeGreaterThan(at("releaseSimple(memories)"));
  });

  it("writes the tombstone last, inside the same transaction as the erasure", () => {
    expect(at("delete(householdWorkspaces)")).toBeLessThan(at("insert(auditLog)"));
    expect(at("purgeWithin")).toBeLessThan(at("insert(auditLog)"));
    pins("executor.transaction(run)");
  });
});

describe("the purge never takes a record the household did not own", () => {
  it("collects only household-native Saved Items, Actions, and Assets for disposal", () => {
    pins('eq(table.ownership, "household_native")');
    expect(at("const savedItemIds = await householdNativeIds(savedItems)")).toBeGreaterThan(
      at("const householdNativeIds"),
    );
    for (const family of ["savedItems", "generalActions", "assets"]) {
      pins(`householdNativeIds(${family})`);
    }
  });

  it("releases a family's rows only when they are member-owned", () => {
    pins('eq(table.ownership, "member_owned")');
    pins('eq(savedItems.ownership, "member_owned")');
  });

  it("returns a released row to private rather than only clearing its household link", () => {
    // Clearing the link alone is what the foreign key already does, and it is
    // the leak-shaped half: a `household`-scope row with a null household is
    // readable by nobody, its own owner included.
    pins('const toPrivate = { scope: "private" as const, householdId: null');
    pins('ne(table.scope, "private")');
  });

  it("bumps each family's concurrency fence, because a release is a write", () => {
    pins("version: sql`${savedItems.version} + 1`");
    pins("revision: sql`${giftPlans.revision} + 1`");
  });

  it("narrows a delivery target that pointed at the household to private", () => {
    pins('targetHouseholdId: null, targetScope: "private"');
  });
});

describe("the purge selects candidates from the index the dissolution built", () => {
  it("filters on dissolved status and the cutoff, oldest first", () => {
    pins('eq(householdWorkspaces.status, "dissolved")');
    pins("isNotNull(householdWorkspaces.dissolvedAt)");
    pins("lte(householdWorkspaces.dissolvedAt, input.cutoff)");
    pins("asc(householdWorkspaces.dissolvedAt)");
    pins(".limit(input.limit)");
  });
});
