import { HOUSEHOLD_RECOVERY_WINDOW_DAYS, householdRecoveryDeadline } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryHouseholdPurgeStore,
  HouseholdPurgeConstraintError,
  type SeededHousehold,
} from "./in-memory-purge-store";
import {
  eraseHousehold,
  HOUSEHOLD_PURGE_DISPOSAL_ORDER,
  HOUSEHOLD_PURGE_FENCED_FAMILIES,
  type HouseholdPurgeCounts,
  householdPurgeTombstone,
  runHouseholdPurgeSweep,
} from "./purge";

const NOW = new Date("2026-09-10T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Dissolved long enough ago that the recovery window has certainly closed. */
const LONG_AGO = new Date(NOW.getTime() - (HOUSEHOLD_RECOVERY_WINDOW_DAYS + 5) * DAY_MS);
/** Dissolved yesterday: still inside the window, still recoverable. */
const YESTERDAY = new Date(NOW.getTime() - DAY_MS);

/**
 * A household holding one row of everything, so the disposal order is exercised
 * rather than skipped over an empty family.
 */
function populated(householdId: string, dissolvedAt: Date): SeededHousehold {
  // Ids are prefixed per household because real ones are unique: two workspaces
  // sharing an Asset id would let one household's disposal reach into another's
  // rows, which is a fixture artifact rather than anything the product can do.
  const id = (name: string) => `${householdId}:${name}`;
  return {
    householdId,
    dissolvedAt,
    rows: [
      {
        id: id("si-native"),
        family: "savedItems",
        ownership: "household_native",
        scope: "household",
      },
      {
        id: id("si-mine"),
        family: "savedItems",
        ownership: "member_owned",
        scope: "household",
        fence: 3,
      },
      {
        id: id("ga-native"),
        family: "generalActions",
        ownership: "household_native",
        scope: "household",
      },
      { id: id("asset"), family: "assets", ownership: "household_native", scope: "household" },
      {
        id: id("am-native"),
        family: "assetMemories",
        ownership: "household_native",
        scope: "household",
        assetId: id("asset"),
      },
      // A member's own note on the household's Asset. It cannot be released -
      // a detail with no Asset is not a record - so it is counted, not lost.
      {
        id: id("am-mine"),
        family: "assetMemories",
        ownership: "member_owned",
        scope: "private",
        assetId: id("asset"),
      },
      {
        id: id("ae-native"),
        family: "assetEvidence",
        ownership: "household_native",
        scope: "household",
        assetId: id("asset"),
      },
      { id: id("conn"), family: "calendarConnections" },
      { id: id("cache"), family: "calendarEventCache", connectionId: id("conn") },
      { id: id("plan"), family: "eventPlans" },
      { id: id("ref"), family: "personReferences" },
      { id: id("fact"), family: "contextFacts" },
      { id: id("invite"), family: "invitations" },
      { id: id("share"), family: "recordShares" },
      { id: id("confirm"), family: "dissolutionConfirmations" },
      { id: id("member-1"), family: "memberships" },
      { id: id("member-2"), family: "memberships" },
      {
        id: id("gift"),
        family: "giftPlans",
        ownership: "member_owned",
        scope: "household",
        fence: 3,
      },
      {
        id: id("asset-mine"),
        family: "assets",
        ownership: "member_owned",
        scope: "household",
        fence: 3,
      },
      {
        id: id("am-shared"),
        family: "assetMemories",
        ownership: "member_owned",
        scope: "household",
        fence: 3,
      },
      {
        id: id("ga-mine"),
        family: "generalActions",
        ownership: "member_owned",
        scope: "household",
      },
      { id: id("source"), family: "sourceRecords", ownership: "member_owned", scope: "household" },
    ],
  };
}

/** The rows still pointing at one household, which is what "erased" means. */
function rowsIn(store: ReturnType<typeof createInMemoryHouseholdPurgeStore>, householdId: string) {
  return store.rows().filter((row) => row.householdId === householdId);
}

const seededRowCount = populated("any", LONG_AGO).rows?.length ?? 0;

describe("the household purge sweep", () => {
  it("disposes of a household whose recovery window has closed", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);

    const result = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(result).toEqual({ scanned: 1, purged: 1, skipped: 0, failed: 0 });
    expect(rowsIn(store, "ended")).toEqual([]);
  });

  it("leaves a household alone while it can still be recovered", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("recent", YESTERDAY)]);

    const result = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(result).toEqual({ scanned: 0, purged: 0, skipped: 0, failed: 0 });
    expect(rowsIn(store, "recent")).not.toEqual([]);
  });

  it("refuses a candidate whose deadline has not passed, whatever the store offered", async () => {
    // The last safe point. A background job proves eligibility again immediately
    // before the durable action rather than trusting the query that selected the
    // work - a wrong cutoff in SQL must not be able to delete a live household.
    const store = createInMemoryHouseholdPurgeStore([
      populated("ended", LONG_AGO),
      populated("recent", YESTERDAY),
    ]);
    store.ignoreCutoff = true;

    const result = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(result).toEqual({ scanned: 2, purged: 1, skipped: 1, failed: 0 });
    expect(rowsIn(store, "ended")).toEqual([]);
    expect(rowsIn(store, "recent")).toHaveLength(seededRowCount);
  });

  it("is safe to re-run: a purged household is gone from the next sweep", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);

    const first = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });
    const second = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(first.purged).toBe(1);
    expect(second).toEqual({ scanned: 0, purged: 0, skipped: 0, failed: 0 });
    expect(store.tombstones).toHaveLength(1);
  });

  it("does no work at all when the run has no budget", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);
    const list = vi.spyOn(store, "listPurgeableHouseholds");

    const result = await runHouseholdPurgeSweep({ limit: 0, now: NOW, store });

    expect(result).toEqual({ scanned: 0, purged: 0, skipped: 0, failed: 0 });
    expect(list).not.toHaveBeenCalled();
  });

  it("takes no more than its budget in one run, oldest first", async () => {
    const store = createInMemoryHouseholdPurgeStore([
      populated("newer", new Date(LONG_AGO.getTime() + DAY_MS)),
      populated("oldest", new Date(LONG_AGO.getTime() - DAY_MS)),
      populated("middle", LONG_AGO),
    ]);

    const result = await runHouseholdPurgeSweep({ limit: 2, now: NOW, store });

    expect(result).toEqual({ scanned: 2, purged: 2, skipped: 0, failed: 0 });
    expect(rowsIn(store, "newer")).toHaveLength(seededRowCount);
    for (const purged of ["oldest", "middle"]) {
      expect(rowsIn(store, purged)).toEqual([]);
    }
  });

  it("keeps one household's failure from stopping the rest, and leaves it whole", async () => {
    const store = createInMemoryHouseholdPurgeStore([
      populated("broken", new Date(LONG_AGO.getTime() - DAY_MS)),
      populated("fine", LONG_AGO),
    ]);
    store.failOn.add("broken");
    const logger = { info: vi.fn(), error: vi.fn() };

    const result = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store, logger });

    expect(result).toEqual({ scanned: 2, purged: 1, skipped: 0, failed: 1 });
    // Half-erased is the one state a re-runnable sweep may never leave behind:
    // the failed household is exactly as it was, down to the released rows still
    // carrying their household scope.
    expect(rowsIn(store, "broken")).toHaveLength(seededRowCount);
    expect(rowsIn(store, "broken").some((row) => row.scope === "household")).toBe(true);
    expect(rowsIn(store, "fine")).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    // The failure is reported by household id and outcome, never by anything the
    // household said. A purge that logs a workspace name has kept content past
    // the moment it promised to erase it.
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("name");
  });

  it("leaves a tombstone for every household it erases", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);

    await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(store.tombstones).toHaveLength(1);
    const tombstone = store.tombstones[0];
    expect(tombstone).toBeDefined();
    expect(tombstone).toMatchObject({
      // Scrubbed system actor: no person decided this, the deadline did. Writing
      // a member's id here would attribute a deletion to someone who did not ask
      // for it and would make the entry readable on their own audit path.
      ownerUserId: null,
      action: "household.purge",
      entityType: "household",
      entityId: "ended",
    });
    expect(tombstone?.metadataJson).toMatchObject({
      householdId: "ended",
      actor: "system",
      recovery: "expired",
      dissolvedAt: LONG_AGO.toISOString(),
      purgedAt: NOW.toISOString(),
      recoveryDeadlineAt: householdRecoveryDeadline(LONG_AGO).toISOString(),
      // Provider-cache material, reported rather than left to a cascade.
      disposedCalendarEventCache: 1,
    });
  });

  it("writes a tombstone even for a household that held nothing", async () => {
    // An empty workspace is still erased, and the trail must still say so:
    // "no entry" and "nothing to remove" are indistinguishable otherwise.
    const store = createInMemoryHouseholdPurgeStore([
      { householdId: "empty", dissolvedAt: LONG_AGO },
    ]);

    await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(store.tombstones).toHaveLength(1);
    expect(store.tombstones[0]?.metadataJson).toMatchObject({ disposedSavedItems: 0 });
  });
});

/**
 * The order, proven by a store that refuses the wrong one.
 *
 * A test that reads the adapter's source and checks that one statement appears
 * before another proves that the statements are written in a sequence. It cannot
 * prove that the sequence is the one Postgres will accept, and it goes on
 * passing if the constraint it protects against were misunderstood. So the
 * in-memory store carries the two schema facts that decide the order - the Saved
 * Item check constraint and the Asset parent cascade - and these cases drive it
 * both ways.
 */
describe("the purge disposes of a household in the one order its constraints allow", () => {
  it("clears household-native Saved Items before the workspace row they check against", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);

    await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(store.disposalOrder).toEqual([...HOUSEHOLD_PURGE_DISPOSAL_ORDER]);
    expect(store.disposalOrder).toContain("savedItems");
  });

  it("would abort the whole erasure if it did not", async () => {
    // The trap, driven directly: `saved_items.household_id` is `on delete set
    // null` and `saved_items_ownership_check` forbids a household-native row
    // without a household, so deleting the workspace first does not orphan the
    // item - it aborts the transaction. This is the case that makes the previous
    // one an assertion about the database rather than about the source text.
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);
    const tx = store.openTransaction("ended");

    for (const family of HOUSEHOLD_PURGE_DISPOSAL_ORDER) {
      if (family === "savedItems") continue;
      await tx.dispose(family);
    }

    await expect(tx.deleteWorkspace()).rejects.toThrow(HouseholdPurgeConstraintError);
    await expect(tx.deleteWorkspace()).rejects.toThrow(/saved_items_ownership_check/);
  });

  it("counts Asset children instead of losing them to their parent's cascade", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);
    const counts = await store.purgeHousehold({ householdId: "ended" }, (tx) =>
      eraseHousehold(tx, { householdId: "ended", dissolvedAt: LONG_AGO, purgedAt: NOW }),
    );

    // Both the workspace's own detail and the member's own note on the
    // workspace's Asset, which the cascade would have taken silently.
    expect(counts.disposed.assetMemories).toBe(2);
    expect(counts.disposed.assetEvidence).toBe(1);
  });

  it("loses that count if the Asset goes first, which is why it does not", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);
    const tx = store.openTransaction("ended");

    await tx.dispose("assets");

    expect(await tx.dispose("assetMemories")).toBe(0);
    expect(await tx.dispose("assetEvidence")).toBe(0);
  });

  it("cancels reminders while the records they name still exist", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);
    const counts = await store.purgeHousehold({ householdId: "ended" }, (tx) =>
      eraseHousehold(tx, { householdId: "ended", dissolvedAt: LONG_AGO, purgedAt: NOW }),
    );

    // `reminder_schedules.record_id` is a bare uuid: a Saved Item's schedules
    // have no foreign key to follow, so once the item is deleted there is
    // nothing left to find them by. A non-zero count is the proof the collection
    // happened while the records were still there.
    expect(counts.disposed.canceledReminders).toBe(2);
  });

  it("removes the provider cache before the connection it hangs off", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);
    const counts = await store.purgeHousehold({ householdId: "ended" }, (tx) =>
      eraseHousehold(tx, { householdId: "ended", dissolvedAt: LONG_AGO, purgedAt: NOW }),
    );

    expect(counts.disposed.calendarEventCache).toBe(1);
    expect(HOUSEHOLD_PURGE_DISPOSAL_ORDER.indexOf("calendarEventCache")).toBeLessThan(
      HOUSEHOLD_PURGE_DISPOSAL_ORDER.indexOf("calendarConnections"),
    );
  });
});

describe("the purge never takes a record the household did not own", () => {
  it("releases member-owned rows to private instead of deleting them", async () => {
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);
    const counts = await store.purgeHousehold({ householdId: "ended" }, (tx) =>
      eraseHousehold(tx, { householdId: "ended", dissolvedAt: LONG_AGO, purgedAt: NOW }),
    );

    expect(counts.released).toMatchObject({
      savedItems: 1,
      giftPlans: 1,
      sourceRecords: 1,
      assets: 1,
      generalActions: 1,
    });
    // Released, not deleted, and unlinked rather than merely rescoped: a
    // `household`-scope row with a null household is readable by nobody, its own
    // owner included, which is what clearing the link alone would leave behind.
    const survivors = store.rows();
    expect(survivors.map((row) => row.id).sort()).toEqual([
      "ended:am-shared",
      "ended:asset-mine",
      "ended:ga-mine",
      "ended:gift",
      "ended:si-mine",
      "ended:source",
    ]);
    expect(survivors.every((row) => row.scope === "private" && row.householdId === null)).toBe(
      true,
    );
  });

  it("bumps the concurrency fence of every family that keeps one, and only those", async () => {
    // A release is a write, so a member still holding the pre-purge version is
    // reconciled rather than allowed to save over a record that has since left
    // the household. Asserted family by family rather than by one example,
    // because the failure is silent and the silent version of it is a lost write.
    const store = createInMemoryHouseholdPurgeStore([populated("ended", LONG_AGO)]);
    await store.purgeHousehold({ householdId: "ended" }, (tx) =>
      eraseHousehold(tx, { householdId: "ended", dissolvedAt: LONG_AGO, purgedAt: NOW }),
    );

    const fenceOf = (id: string) => store.rows().find((row) => row.id === id)?.fence;
    expect(HOUSEHOLD_PURGE_FENCED_FAMILIES).toEqual([
      "savedItems",
      "giftPlans",
      "assets",
      "assetMemories",
    ]);
    for (const id of ["ended:si-mine", "ended:gift", "ended:asset-mine", "ended:am-shared"]) {
      expect(fenceOf(id), `${id} fence`).toBe(4);
    }
    // General Actions have no fence column and Asset Evidence is immutable once
    // captured, so neither has a concurrent write for a fence to catch.
    expect(fenceOf("ended:ga-mine")).toBeUndefined();
  });
});

describe("the purge tombstone", () => {
  const disposed = Object.fromEntries(
    HOUSEHOLD_PURGE_DISPOSAL_ORDER.map((family) => [family, 0]),
  ) as HouseholdPurgeCounts["disposed"];
  const counts: HouseholdPurgeCounts = {
    disposed: { ...disposed, canceledReminders: 0, savedItems: 3, memberships: 4 },
    released: {
      giftPlans: 1,
      memories: 0,
      sourceRecords: 5,
      followups: 0,
      generalActions: 0,
      assets: 0,
      assetMemories: 0,
      assetEvidence: 0,
      savedItems: 0,
      briefItems: 0,
    },
  };

  const entry = householdPurgeTombstone({
    householdId: "ended",
    dissolvedAt: LONG_AGO,
    purgedAt: NOW,
    counts,
  });

  it("records what moved and nothing about what any of it said", () => {
    expect(entry.metadataJson).toMatchObject({
      disposedSavedItems: 3,
      disposedMemberships: 4,
      releasedGiftPlans: 1,
      releasedSourceRecords: 5,
    });
  });

  it("carries only identifiers, counts, times, and outcome", () => {
    // The privacy evidence's list of what an audit entry may hold, enforced as a
    // shape rather than trusted: every value is an id, a number, a timestamp, or
    // one of a small set of markers. A title, preview, or name would be a string
    // that is none of those.
    const allowedStrings = new Set([
      "ended",
      "system",
      "expired",
      LONG_AGO.toISOString(),
      NOW.toISOString(),
      householdRecoveryDeadline(LONG_AGO).toISOString(),
    ]);
    for (const value of Object.values(entry.metadataJson)) {
      if (typeof value === "number") continue;
      expect(typeof value).toBe("string");
      expect(allowedStrings).toContain(value as string);
    }
  });

  it("names no member, so a departed person's id cannot be read back out of it", () => {
    expect(entry.ownerUserId).toBeNull();
    expect(JSON.stringify(entry.metadataJson)).not.toContain("userId");
  });
});
