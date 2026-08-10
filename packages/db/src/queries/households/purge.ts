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
 * forever. That gap is the one thing the privacy evidence does not tolerate -
 * "at permanent deletion, content and provider-cache material are removed; only
 * the approved minimized non-content audit tombstone remains" described a
 * deletion that had no implementation (ADR 0221).
 *
 * Three rules shape everything below.
 *
 * **Only the workspace's own records are deleted.** A household-native record is
 * owned by the workspace (ADR 0214), so when the workspace goes, it goes.
 * A member-owned record is not the household's to erase, however long it sat in
 * one: dissolution already returned those to `private`, and anything still
 * pointing at the household here is a leftover from a best-effort post-commit
 * hook rather than a record the household ever owned. Those are *released*, not
 * disposed of - which is also the only correct reading of the FK's `set null`,
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
 *
 * The disposal *order* lives here rather than in the storage adapter, because it
 * is a fact about the schema's constraints rather than about SQL, and because a
 * plan the service owns is a plan a store with no database can be made to
 * execute and refuse. `in-memory-purge-store.ts` does exactly that; `db:purge:check`
 * confirms the same order against a real Postgres.
 */

/** A dissolved household the sweep may consider. Ids and a moment; no content. */
export type PurgeableHousehold = {
  householdId: string;
  dissolvedAt: Date;
};

/**
 * A family of rows the workspace owns outright, named so the order below is a
 * list rather than a paragraph.
 */
export type HouseholdPurgeFamily =
  | "assetEvidence"
  | "assetMemories"
  | "assets"
  | "savedItems"
  | "generalActions"
  | "calendarEventCache"
  | "calendarConnections"
  | "eventPlans"
  | "personReferences"
  | "contextFacts"
  | "invitations"
  | "recordShares"
  | "dissolutionConfirmations"
  | "memberships";

/**
 * The one order every constraint allows, as data.
 *
 * Each position has a specific wrong answer with a specific consequence, and
 * none of them is visible in a type or caught by a lint:
 *
 * - Asset children precede their Asset. The foreign key would cascade them away
 *   regardless, so what the order buys is a count rather than a silent removal.
 * - Saved Items precede the workspace row, which is enforced elsewhere and
 *   structurally: `saved_items.household_id` is `on delete set null` and
 *   `saved_items_ownership_check` forbids a household-native row without a
 *   household, so deleting the workspace while one survives does not orphan the
 *   row, it aborts the whole transaction. `general_actions` and `assets` have no
 *   equivalent check, so the same mistake there fails silently instead, leaving
 *   a `household_native` row with a null household that no proof can ever
 *   authorize. Same rule, quieter failure.
 * - The provider cache precedes its Connection, for the reason the privacy
 *   evidence names provider-cache material explicitly: a sweep that let the
 *   cascade take it could not report that it had gone.
 *
 * Everything keyed to the workspace by a cascading foreign key would go with the
 * workspace row anyway. It is disposed explicitly regardless, because a sweep
 * whose inventory is "whatever the database happens to cascade" cannot report
 * what it removed and cannot be read as a list of what a household is made of.
 */
export const HOUSEHOLD_PURGE_DISPOSAL_ORDER: readonly HouseholdPurgeFamily[] = [
  "assetEvidence",
  "assetMemories",
  "assets",
  "savedItems",
  "generalActions",
  "calendarEventCache",
  "calendarConnections",
  "eventPlans",
  "personReferences",
  "contextFacts",
  "invitations",
  "recordShares",
  "dissolutionConfirmations",
  "memberships",
];

/**
 * Household-native rows removed, per family.
 *
 * Counted rather than returned, for the same reason governance counts its
 * reverts: the sweep says *that* these things went and is given no way to read
 * any of it.
 */
export type HouseholdDisposedCounts = Record<HouseholdPurgeFamily, number> & {
  /** Schedules and pending intents standing on the records being disposed of. */
  canceledReminders: number;
};

/**
 * The released families that carry an optimistic-concurrency fence, which a
 * release has to bump because a release is a write.
 *
 * A member still holding the pre-purge version is then reconciled rather than
 * allowed to save over a record that has since left the household. Named here
 * rather than in the adapter so the store that talks to Postgres and the store
 * that models it cannot come to disagree about which families have one - the
 * failure otherwise is silent, and the silent version of it is a lost write.
 *
 * Gift Plans, Assets, and Asset Memories call theirs `revision`; Saved Items
 * call theirs `version`. General Actions have no fence at all, and Asset
 * Evidence is immutable once captured, so neither has a concurrent write for a
 * fence to catch.
 */
export const HOUSEHOLD_PURGE_FENCED_FAMILIES = [
  "savedItems",
  "giftPlans",
  "assets",
  "assetMemories",
] as const;

export type HouseholdPurgeFencedFamily = (typeof HOUSEHOLD_PURGE_FENCED_FAMILIES)[number];

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
 * `ownerUserId` is null by design - the scrubbed system actor the privacy
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

/**
 * One household's erasure, mid-flight.
 *
 * Every method is scoped to the household the transaction was opened for, so
 * nothing here takes a household id and no mistake in the sequence below can
 * reach a second workspace.
 */
export type HouseholdPurgeTransaction = {
  /**
   * The workspace's own records that a Reminder Schedule can name.
   *
   * Collected before anything is deleted, because `reminder_schedules.record_id`
   * is a bare uuid: a Saved Item's schedules have no foreign key to follow, so
   * once the item is gone there is nothing left to find them by.
   */
  collectRemindableRecordIds: () => Promise<string[]>;
  /** Every schedule, pending intent, and queued delivery standing on those records. */
  cancelReminders: (input: { recordIds: readonly string[]; at: Date }) => Promise<number>;
  /** Removes the workspace's own rows in one family, and says how many moved. */
  dispose: (family: HouseholdPurgeFamily) => Promise<number>;
  /** Returns member-owned rows still pointing at this household to `private`. */
  release: (input: { at: Date }) => Promise<HouseholdReleasedCounts>;
  deleteWorkspace: () => Promise<void>;
  writeTombstone: (tombstone: HouseholdPurgeTombstone) => Promise<void>;
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
   * Opens one atomic scope over one household and runs `erase` inside it.
   *
   * The whole erasure or none of it, because the intermediate states are not
   * valid households: a workspace whose Saved Items are gone but whose Assets
   * remain is not a smaller household, it is a broken one. It is also what makes
   * the sweep safe to re-run - a failure leaves the household still there for
   * the next pass rather than half-erased.
   */
  purgeHousehold: <T>(
    input: { householdId: string },
    erase: (tx: HouseholdPurgeTransaction) => Promise<T>,
  ) => Promise<T>;
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
 * The entry the sweep leaves behind, built once so no two stores can come to
 * disagree about what a tombstone may hold.
 *
 * The metadata is flat and scalar on purpose. Every value is an identifier, a
 * count, a timestamp, or one of a small set of fixed markers, which is a shape a
 * test can enforce - a title, preview, or member name would be a string that is
 * none of those.
 */
export function householdPurgeTombstone(input: {
  householdId: string;
  dissolvedAt: Date;
  purgedAt: Date;
  counts: HouseholdPurgeCounts;
}): HouseholdPurgeTombstone {
  const flattened: Record<string, number> = {};
  const prefixed = (prefix: string, family: string, count: number) => {
    flattened[`${prefix}${family[0]?.toUpperCase()}${family.slice(1)}`] = count;
  };
  for (const [family, count] of Object.entries(input.counts.disposed)) {
    prefixed("disposed", family, count);
  }
  for (const [family, count] of Object.entries(input.counts.released)) {
    prefixed("released", family, count);
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
 * One household erased, in the order {@link HOUSEHOLD_PURGE_DISPOSAL_ORDER}
 * fixes, inside whatever atomic scope the store opened.
 *
 * Exported so a store's own suite can drive the same sequence it will run in
 * production, rather than a paraphrase of it.
 */
export async function eraseHousehold(
  tx: HouseholdPurgeTransaction,
  input: { householdId: string; dissolvedAt: Date; purgedAt: Date },
): Promise<HouseholdPurgeCounts> {
  const remindableRecordIds = await tx.collectRemindableRecordIds();
  const canceledReminders = await tx.cancelReminders({
    recordIds: remindableRecordIds,
    at: input.purgedAt,
  });

  const disposed = { canceledReminders } as HouseholdDisposedCounts;
  for (const family of HOUSEHOLD_PURGE_DISPOSAL_ORDER) {
    disposed[family] = await tx.dispose(family);
  }

  // Last, and after the workspace's own records are gone, so nothing the
  // household kept is left grounded on evidence it can no longer reach.
  const released = await tx.release({ at: input.purgedAt });
  await tx.deleteWorkspace();

  const counts: HouseholdPurgeCounts = { disposed, released };
  await tx.writeTombstone(householdPurgeTombstone({ ...input, counts }));
  return counts;
}

/**
 * One bounded pass over the dissolved households whose window has closed.
 *
 * Per-household error isolation rather than one transaction over the batch: a
 * household that cannot be erased - a lock, a family the sweep has not learned
 * about - must not keep every other household's promised deletion waiting. The
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
      const counts = await input.store.purgeHousehold(
        { householdId: candidate.householdId },
        (tx) =>
          eraseHousehold(tx, {
            householdId: candidate.householdId,
            dissolvedAt: candidate.dissolvedAt,
            purgedAt: now,
          }),
      );
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
