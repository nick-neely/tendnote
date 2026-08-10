import { HOUSEHOLD_RECOVERY_WINDOW_DAYS, householdRecoveryDeadline } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryHouseholdPurgeStore,
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

function emptyCounts(): HouseholdPurgeCounts {
  return {
    disposed: {
      savedItems: 0,
      generalActions: 0,
      assets: 0,
      assetMemories: 0,
      assetEvidence: 0,
      eventPlans: 0,
      contextFacts: 0,
      personReferences: 0,
      invitations: 0,
      calendarConnections: 0,
      recordShares: 0,
      memberships: 0,
      canceledReminders: 0,
    },
    released: {
      giftPlans: 0,
      memories: 0,
      sourceRecords: 0,
      followups: 0,
      generalActions: 0,
      assets: 0,
      assetMemories: 0,
      assetEvidence: 0,
      savedItems: 0,
      briefItems: 0,
    },
  };
}

describe("the household purge sweep", () => {
  it("disposes of a household whose recovery window has closed", async () => {
    const store = createInMemoryHouseholdPurgeStore([
      { householdId: "ended", dissolvedAt: LONG_AGO },
    ]);

    const result = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(result).toEqual({ scanned: 1, purged: 1, skipped: 0, failed: 0 });
    expect(store.purged).toEqual(["ended"]);
  });

  it("leaves a household alone while it can still be recovered", async () => {
    // The store is asked for candidates past the cutoff, so the correct outcome
    // is that this household is never even offered — proven by asking the store
    // for its whole list and finding the sweep took none of it.
    const store = createInMemoryHouseholdPurgeStore([
      { householdId: "recent", dissolvedAt: YESTERDAY },
    ]);

    const result = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(result).toEqual({ scanned: 0, purged: 0, skipped: 0, failed: 0 });
    expect(store.purged).toEqual([]);
  });

  it("refuses a candidate whose deadline has not passed, whatever the store offered", async () => {
    // The last safe point. A background job proves eligibility again immediately
    // before the durable action rather than trusting the query that selected the
    // work — a wrong cutoff in SQL must not be able to delete a live household.
    const store = createInMemoryHouseholdPurgeStore([
      { householdId: "ended", dissolvedAt: LONG_AGO },
      { householdId: "recent", dissolvedAt: YESTERDAY },
    ]);
    store.ignoreCutoff = true;

    const result = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(result).toEqual({ scanned: 2, purged: 1, skipped: 1, failed: 0 });
    expect(store.purged).toEqual(["ended"]);
  });

  it("is safe to re-run: a purged household is gone from the next sweep", async () => {
    const store = createInMemoryHouseholdPurgeStore([
      { householdId: "ended", dissolvedAt: LONG_AGO },
    ]);

    const first = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });
    const second = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(first.purged).toBe(1);
    expect(second).toEqual({ scanned: 0, purged: 0, skipped: 0, failed: 0 });
    expect(store.purged).toEqual(["ended"]);
    expect(store.tombstones).toHaveLength(1);
  });

  it("does no work at all when the run has no budget", async () => {
    const store = createInMemoryHouseholdPurgeStore([
      { householdId: "ended", dissolvedAt: LONG_AGO },
    ]);
    const list = vi.spyOn(store, "listPurgeableHouseholds");

    const result = await runHouseholdPurgeSweep({ limit: 0, now: NOW, store });

    expect(result).toEqual({ scanned: 0, purged: 0, skipped: 0, failed: 0 });
    expect(list).not.toHaveBeenCalled();
  });

  it("takes no more than its budget in one run, oldest first", async () => {
    const store = createInMemoryHouseholdPurgeStore([
      { householdId: "newer", dissolvedAt: new Date(LONG_AGO.getTime() + DAY_MS) },
      { householdId: "oldest", dissolvedAt: new Date(LONG_AGO.getTime() - DAY_MS) },
      { householdId: "middle", dissolvedAt: LONG_AGO },
    ]);

    const result = await runHouseholdPurgeSweep({ limit: 2, now: NOW, store });

    expect(result).toEqual({ scanned: 2, purged: 2, skipped: 0, failed: 0 });
    expect(store.purged).toEqual(["oldest", "middle"]);
  });

  it("keeps one household's failure from stopping the rest", async () => {
    const store = createInMemoryHouseholdPurgeStore([
      { householdId: "broken", dissolvedAt: new Date(LONG_AGO.getTime() - DAY_MS) },
      { householdId: "fine", dissolvedAt: LONG_AGO },
    ]);
    store.failOn.add("broken");
    const logger = { info: vi.fn(), error: vi.fn() };

    const result = await runHouseholdPurgeSweep({ limit: 10, now: NOW, store, logger });

    expect(result).toEqual({ scanned: 2, purged: 1, skipped: 0, failed: 1 });
    expect(store.purged).toEqual(["fine"]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    // The failure is reported by household id and outcome, never by anything the
    // household said. A purge that logs a workspace name has kept content past
    // the moment it promised to erase it.
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("name");
  });

  it("leaves a tombstone for every household it erases", async () => {
    const store = createInMemoryHouseholdPurgeStore([
      { householdId: "ended", dissolvedAt: LONG_AGO },
    ]);

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
    });
  });

  it("writes a tombstone even for a household that held nothing", async () => {
    // An empty workspace is still erased, and the trail must still say so:
    // "no entry" and "nothing to remove" are indistinguishable otherwise.
    const store = createInMemoryHouseholdPurgeStore([
      { householdId: "empty", dissolvedAt: LONG_AGO },
    ]);
    store.counts.set("empty", emptyCounts());

    await runHouseholdPurgeSweep({ limit: 10, now: NOW, store });

    expect(store.tombstones).toHaveLength(1);
    expect(store.tombstones[0]?.metadataJson).toMatchObject({ disposedSavedItems: 0 });
  });
});

describe("the purge tombstone", () => {
  const counts: HouseholdPurgeCounts = {
    disposed: { ...emptyCounts().disposed, savedItems: 3, generalActions: 2, memberships: 4 },
    released: { ...emptyCounts().released, giftPlans: 1, sourceRecords: 5 },
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
      disposedGeneralActions: 2,
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
