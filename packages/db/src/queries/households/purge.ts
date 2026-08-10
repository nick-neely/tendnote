import {
  householdPurgeCutoff,
  householdRecoveryDeadline,
  isHouseholdPurgeDue,
} from "@tendnote/domain";

/**
 * What closing the recovery window actually does to a household's records.
 *
 * `dissolve` ends access and opens a thirty-day window in which support can put
 * a household back. Until this existed nothing closed that window: the copy
 * promised recovery would stop being offered, and the records simply stayed
 * forever. That gap is the one thing the privacy evidence does not tolerate —
 * "at permanent deletion, content and provider-cache material are removed; only
 * the approved minimized non-content audit tombstone remains" describes a
 * deletion that had no implementation.
 *
 * Three rules shape everything below.
 *
 * **Only the workspace's own records are deleted.** A household-native record is
 * owned by the workspace (ADR 0214), so when the workspace goes, it goes.
 * A member-owned record is not the household's to erase, however long it sat in
 * one: dissolution already returned those to `private`, and anything still
 * pointing at the household here is a leftover from a best-effort post-commit
 * hook rather than a record the household ever owned. Those are *released*, not
 * disposed of — which is also the only correct reading of the FK's `set null`,
 * since a `household`-scope row with a null `household_id` is readable by
 * nobody, its owner included.
 *
 * **The sweep proves eligibility twice.** The SQL selects by cutoff and the
 * service checks the same boundary again immediately before the delete, because
 * a background job proves authority again at the last safe point and a durable,
 * irreversible action is the last safe point there is.
 *
 * **The trail survives the content.** A tombstone naming the household, the two
 * moments, and how much of each family moved is written in the same transaction
 * as the deletes, with a scrubbed system actor: no person decided this, the
 * deadline did.
 */

/** A dissolved household the sweep may consider. Ids and a moment; no content. */
export type PurgeableHousehold = {
  householdId: string;
  dissolvedAt: Date;
};

/**
 * Household-native rows removed, per family.
 *
 * Counted rather than returned, for the same reason governance counts its
 * reverts: the sweep says *that* these things went and is given no way to read
 * any of it.
 */
export type HouseholdDisposedCounts = {
  savedItems: number;
  generalActions: number;
  assets: number;
  assetMemories: number;
  assetEvidence: number;
  eventPlans: number;
  contextFacts: number;
  personReferences: number;
  invitations: number;
  calendarConnections: number;
  recordShares: number;
  memberships: number;
  /** Schedules and pending intents standing on the records being disposed of. */
  canceledReminders: number;
};

/**
 * Member-owned rows found still pointing at the household and returned to
 * `private`, per family.
 *
 * A non-zero count here is not an error: Gift Plans are privatized by a
 * best-effort post-commit hook, and Source Records grounding a household-native
 * record are deliberately held back at dissolution precisely so the workspace's
 * own record stays readable until it is gone. This is where they come home.
 */
export type HouseholdReleasedCounts = {
  giftPlans: number;
  memories: number;
  sourceRecords: number;
  followups: number;
  generalActions: number;
  assets: number;
  assetMemories: number;
  assetEvidence: number;
  savedItems: number;
  briefItems: number;
};

export type HouseholdPurgeCounts = {
  disposed: HouseholdDisposedCounts;
  released: HouseholdReleasedCounts;
};

/**
 * The minimized non-content entry that outlives the household, for the two-year
 * audit period.
 *
 * `ownerUserId` is null by design — the scrubbed system actor the privacy
 * evidence allows. Naming a member would attribute an erasure to someone who did
 * not ask for it, and would file the entry on their own audit path, where a
 * household they have long left would reappear.
 */
export type HouseholdPurgeTombstone = {
  ownerUserId: null;
  action: "household.purge";
  entityType: "household";
  entityId: string;
  metadataJson: Record<string, string | number>;
};

export type HouseholdPurgeStore = {
  /**
   * Dissolved households whose recovery window closed at or before `cutoff`,
   * oldest first, at most `limit` of them.
   *
   * Oldest first so a backlog drains in the order it accumulated and no
   * household can be starved by a steadier stream of newer ones.
   */
  listPurgeableHouseholds: (input: {
    cutoff: Date;
    limit: number;
  }) => Promise<PurgeableHousehold[]>;
  /**
   * Disposes of one household and everything the workspace owns, and writes its
   * tombstone, in a single transaction.
   *
   * One call rather than a step per family because the intermediate states are
   * not valid households: a workspace whose Saved Items are gone but whose
   * Assets remain is not a smaller household, it is a broken one. Either the
   * whole erasure commits or the household is still there to try again next run,
   * which is also what makes the sweep safe to re-run.
   */
  purgeHousehold: (input: {
    householdId: string;
    dissolvedAt: Date;
    purgedAt: Date;
  }) => Promise<HouseholdPurgeCounts>;
};

export type HouseholdPurgeLogger = {
  info?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
};

export type HouseholdPurgeSweepResult = {
  /** Candidates the store offered and the sweep looked at. */
  scanned: number;
  /** Households erased. */
  purged: number;
  /** Candidates refused at the last safe point because their deadline had not passed. */
  skipped: number;
  /** Candidates whose erasure failed and will be retried by a later run. */
  failed: number;
};

/**
 * The entry the sweep leaves behind, built once so the real store and its
 * in-memory twin cannot come to disagree about what a tombstone may hold.
 *
 * The metadata is flat and scalar on purpose. Every value is an identifier, a
 * count, a timestamp, or one of a small set of fixed markers, which is a shape a
 * test can enforce — a title, preview, or member name would be a string that is
 * none of those.
 */
export function householdPurgeTombstone(input: {
  householdId: string;
  dissolvedAt: Date;
  purgedAt: Date;
  counts: HouseholdPurgeCounts;
}): HouseholdPurgeTombstone {
  const flattened: Record<string, number> = {};
  for (const [family, count] of Object.entries(input.counts.disposed)) {
    flattened[`disposed${family[0]?.toUpperCase()}${family.slice(1)}`] = count;
  }
  for (const [family, count] of Object.entries(input.counts.released)) {
    flattened[`released${family[0]?.toUpperCase()}${family.slice(1)}`] = count;
  }

  return {
    ownerUserId: null,
    action: "household.purge",
    entityType: "household",
    entityId: input.householdId,
    metadataJson: {
      householdId: input.householdId,
      actor: "system",
      // The outcome, in the vocabulary `household.dissolve` already used: that
      // entry says `recovery: "support-only"`, and this one says the window it
      // opened has closed.
      recovery: "expired",
      dissolvedAt: input.dissolvedAt.toISOString(),
      recoveryDeadlineAt: householdRecoveryDeadline(input.dissolvedAt).toISOString(),
      purgedAt: input.purgedAt.toISOString(),
      ...flattened,
    },
  };
}

/**
 * One bounded pass over the dissolved households whose window has closed.
 *
 * Per-household error isolation rather than one transaction over the batch: a
 * household that cannot be erased — a lock, a family the sweep has not learned
 * about — must not keep every other household's promised deletion waiting. The
 * failure is counted, logged by id and outcome only, and retried next run.
 */
export async function runHouseholdPurgeSweep(input: {
  limit: number;
  store: HouseholdPurgeStore;
  now?: Date;
  logger?: HouseholdPurgeLogger;
}): Promise<HouseholdPurgeSweepResult> {
  const result: HouseholdPurgeSweepResult = { scanned: 0, purged: 0, skipped: 0, failed: 0 };
  if (input.limit <= 0) return result;

  const now = input.now ?? new Date();
  const candidates = await input.store.listPurgeableHouseholds({
    cutoff: householdPurgeCutoff(now),
    limit: input.limit,
  });

  for (const candidate of candidates) {
    result.scanned += 1;

    // The last safe point, and the reason the boundary lives in the domain: the
    // sweep re-decides eligibility from the household's own `dissolvedAt`
    // immediately before an irreversible action, rather than trusting the query
    // that selected it.
    if (!isHouseholdPurgeDue({ dissolvedAt: candidate.dissolvedAt, now })) {
      result.skipped += 1;
      input.logger?.info?.("household_purge.not_due", { householdId: candidate.householdId });
      continue;
    }

    try {
      const counts = await input.store.purgeHousehold({
        householdId: candidate.householdId,
        dissolvedAt: candidate.dissolvedAt,
        purgedAt: now,
      });
      result.purged += 1;
      input.logger?.info?.("household_purge.completed", {
        householdId: candidate.householdId,
        ...counts.disposed,
      });
    } catch (error) {
      result.failed += 1;
      input.logger?.error?.("household_purge.failed", {
        householdId: candidate.householdId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * The in-memory twin, for the sweep's own behavioral tests.
 *
 * A real fake rather than a no-op: what these tests are about is which
 * candidates the sweep accepts, refuses, and retries, and that needs a store
 * that can offer an ineligible candidate and can fail. The SQL those decisions
 * end in is proven against the Drizzle store and against a live database.
 */
export function createInMemoryHouseholdPurgeStore(
  households: readonly PurgeableHousehold[] = [],
): HouseholdPurgeStore & {
  purged: string[];
  tombstones: HouseholdPurgeTombstone[];
  counts: Map<string, HouseholdPurgeCounts>;
  failOn: Set<string>;
  /** Offers every dissolved household regardless of cutoff, to exercise the re-check. */
  ignoreCutoff: boolean;
} {
  const remaining = [...households];
  const store = {
    purged: [] as string[],
    tombstones: [] as HouseholdPurgeTombstone[],
    counts: new Map<string, HouseholdPurgeCounts>(),
    failOn: new Set<string>(),
    ignoreCutoff: false,

    async listPurgeableHouseholds(query: { cutoff: Date; limit: number }) {
      return remaining
        .filter((household) => store.ignoreCutoff || household.dissolvedAt <= query.cutoff)
        .sort((left, right) => left.dissolvedAt.getTime() - right.dissolvedAt.getTime())
        .slice(0, query.limit);
    },

    async purgeHousehold(command: { householdId: string; dissolvedAt: Date; purgedAt: Date }) {
      if (store.failOn.has(command.householdId)) {
        throw new Error("purge failed");
      }
      const counts = store.counts.get(command.householdId) ?? DEFAULT_IN_MEMORY_COUNTS;
      const index = remaining.findIndex(
        (household) => household.householdId === command.householdId,
      );
      if (index >= 0) remaining.splice(index, 1);
      store.purged.push(command.householdId);
      store.tombstones.push(householdPurgeTombstone({ ...command, counts }));
      return counts;
    },
  };
  return store;
}

const DEFAULT_IN_MEMORY_COUNTS: HouseholdPurgeCounts = {
  disposed: {
    savedItems: 1,
    generalActions: 1,
    assets: 1,
    assetMemories: 1,
    assetEvidence: 1,
    eventPlans: 1,
    contextFacts: 1,
    personReferences: 1,
    invitations: 1,
    calendarConnections: 1,
    recordShares: 1,
    memberships: 2,
    canceledReminders: 1,
  },
  released: {
    giftPlans: 1,
    memories: 1,
    sourceRecords: 1,
    followups: 1,
    generalActions: 0,
    assets: 0,
    assetMemories: 0,
    assetEvidence: 0,
    savedItems: 0,
    briefItems: 0,
  },
};
