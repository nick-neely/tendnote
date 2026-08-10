import { and, asc, eq, inArray, isNotNull, lte, ne, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DatabaseExecutor } from "../../client";
import { getDb } from "../../client";
import {
  assetEvidence,
  assetMemories,
  assets,
  auditLog,
  briefItems,
  contextFacts,
  followups,
  generalActions,
  giftPlans,
  householdCalendarConnections,
  householdCalendarEventCache,
  householdDissolutionConfirmations,
  householdEventPlans,
  householdInvitations,
  householdMemberships,
  householdRecordShares,
  householdWorkspaces,
  memories,
  personReferences,
  savedItems,
  scheduledWorkflowDeliverySettings,
  sourceRecords,
} from "../../schema";
import type {
  HouseholdPurgeFamily,
  HouseholdPurgeFencedFamily,
  HouseholdPurgeStore,
  HouseholdPurgeTransaction,
  HouseholdReleasedCounts,
} from "./purge";
import { createDrizzleHouseholdScheduledWorkStore } from "./scheduled-work";

/**
 * The erasure in SQL, one statement per family the service asks for.
 *
 * The *order* is not decided here - it lives in `purge.ts` beside the reasons
 * for it, so a store with no database can be made to execute the same plan and
 * refuse a wrong one. What this file owns is which rows each family means, and
 * the one rule that governs every predicate below: a household-native row is the
 * workspace's and is deleted; a member-owned row never was, and is released.
 */
export function createDrizzleHouseholdPurgeStore(
  resolveDb: () => DatabaseExecutor = getDb,
): HouseholdPurgeStore {
  return {
    async listPurgeableHouseholds(input) {
      if (input.limit <= 0) return [];
      const rows = await resolveDb()
        .select({
          householdId: householdWorkspaces.id,
          dissolvedAt: householdWorkspaces.dissolvedAt,
        })
        .from(householdWorkspaces)
        .where(
          and(
            eq(householdWorkspaces.status, "dissolved"),
            isNotNull(householdWorkspaces.dissolvedAt),
            lte(householdWorkspaces.dissolvedAt, input.cutoff),
          ),
        )
        // Oldest first, and the exact shape of
        // `household_workspaces_status_dissolved_at_idx`, so a backlog is a
        // bounded index range rather than a scan of every household ever ended.
        .orderBy(asc(householdWorkspaces.dissolvedAt))
        .limit(input.limit);

      return rows.flatMap((row) =>
        row.dissolvedAt ? [{ householdId: row.householdId, dissolvedAt: row.dissolvedAt }] : [],
      );
    },

    purgeHousehold(input, erase) {
      const executor = resolveDb();
      const run = (tx: DatabaseExecutor) => erase(createPurgeTransaction(tx, input.householdId));
      // `transaction` on an already-open transaction opens a savepoint, which is
      // the right nesting either way, so a caller that hands one in is served
      // atomically without this having to tell the two apart.
      return "transaction" in executor ? executor.transaction(run) : run(executor);
    },
  };
}

function createPurgeTransaction(
  tx: DatabaseExecutor,
  householdId: string,
): HouseholdPurgeTransaction {
  /** This household's rows in a family the workspace can own outright. */
  const householdNative = (table: typeof savedItems | typeof generalActions | typeof assets) =>
    and(eq(table.householdId, householdId), eq(table.ownership, "household_native"));

  /**
   * A household-native detail, or any detail hanging off an Asset that is about
   * to go.
   *
   * The second half is not redundant. A member's own note on the household's
   * refrigerator is member-owned and cannot be released instead, because an
   * Asset detail with no Asset is not a record anyone can read. The cascade
   * would remove it either way; matching it here is what lets the trail count it
   * rather than lose it silently.
   */
  const assetChild = (table: typeof assetMemories | typeof assetEvidence) =>
    or(
      and(eq(table.householdId, householdId), eq(table.ownership, "household_native")),
      inArray(
        table.assetId,
        tx.select({ id: assets.id }).from(assets).where(householdNative(assets)),
      ),
    );

  const DISPOSALS: Record<HouseholdPurgeFamily, () => Promise<number>> = {
    assetEvidence: () => deleteReturning(tx, assetEvidence, assetChild(assetEvidence)),
    assetMemories: () => deleteReturning(tx, assetMemories, assetChild(assetMemories)),
    assets: () => deleteReturning(tx, assets, householdNative(assets)),
    savedItems: () => deleteReturning(tx, savedItems, householdNative(savedItems)),
    generalActions: () => deleteReturning(tx, generalActions, householdNative(generalActions)),
    // Provider-cache material, named rather than cascaded: the privacy evidence
    // promises it is removed at permanent deletion, and a promise the sweep
    // cannot report on is a promise it cannot be held to (ADR 0221).
    calendarEventCache: () =>
      deleteReturning(
        tx,
        householdCalendarEventCache,
        inArray(
          householdCalendarEventCache.connectionId,
          tx
            .select({ id: householdCalendarConnections.id })
            .from(householdCalendarConnections)
            .where(eq(householdCalendarConnections.householdId, householdId)),
        ),
      ),
    calendarConnections: () =>
      deleteReturning(
        tx,
        householdCalendarConnections,
        eq(householdCalendarConnections.householdId, householdId),
      ),
    eventPlans: () =>
      deleteReturning(tx, householdEventPlans, eq(householdEventPlans.householdId, householdId)),
    personReferences: () =>
      deleteReturning(tx, personReferences, eq(personReferences.householdId, householdId)),
    contextFacts: () =>
      deleteReturning(tx, contextFacts, eq(contextFacts.subjectHouseholdId, householdId)),
    invitations: () =>
      deleteReturning(tx, householdInvitations, eq(householdInvitations.householdId, householdId)),
    recordShares: () =>
      deleteReturning(
        tx,
        householdRecordShares,
        eq(householdRecordShares.householdId, householdId),
      ),
    dissolutionConfirmations: () =>
      deleteReturning(
        tx,
        householdDissolutionConfirmations,
        eq(householdDissolutionConfirmations.householdId, householdId),
      ),
    memberships: () =>
      deleteReturning(tx, householdMemberships, eq(householdMemberships.householdId, householdId)),
  };

  return {
    async collectRemindableRecordIds() {
      const ids = async (table: typeof savedItems | typeof generalActions) =>
        (await tx.select({ id: table.id }).from(table).where(householdNative(table))).map(
          (row) => row.id,
        );
      return [...(await ids(savedItems)), ...(await ids(generalActions))];
    },

    cancelReminders(input) {
      // Reused rather than rewritten: this is the same cancellation a departure
      // performs, and two implementations of "these reminders end now" would be
      // two chances to disagree about what that means.
      return createDrizzleHouseholdScheduledWorkStore(() => tx).cancelRemindersForRecords(input);
    },

    dispose: (family) => DISPOSALS[family](),

    release: (input) => releaseMemberOwnedRecords(tx, { householdId, at: input.at }),

    async deleteWorkspace() {
      await tx.delete(householdWorkspaces).where(eq(householdWorkspaces.id, householdId));
    },

    async writeTombstone(tombstone) {
      // Written through the table rather than the household store's audit
      // helper, which requires a member id: this entry has no actor by design,
      // and the scrubbed system form is exactly what the privacy evidence
      // allows.
      await tx.insert(auditLog).values({
        ownerUserId: tombstone.ownerUserId,
        action: tombstone.action,
        entityType: tombstone.entityType,
        entityId: tombstone.entityId,
        metadataJson: tombstone.metadataJson,
      });
    },
  };
}

/**
 * Returns member-owned rows still pointing at this household to `private`.
 *
 * `ne(scope, "private")` on every family, so a row that already came home is not
 * counted twice by a re-run. Every family that carries an optimistic-concurrency
 * fence bumps it, because a release is a write: a member still holding the
 * pre-purge version is then reconciled rather than allowed to save over a record
 * that has since left the household.
 */
async function releaseMemberOwnedRecords(
  tx: DatabaseExecutor,
  input: { householdId: string; at: Date },
): Promise<HouseholdReleasedCounts> {
  const toPrivate = { scope: "private" as const, householdId: null, updatedAt: input.at };
  const stillShared = (table: { householdId: PgColumn; scope: PgColumn }) =>
    and(eq(table.householdId, input.householdId), ne(table.scope, "private"));

  const releaseSimple = (
    table: typeof memories | typeof followups | typeof sourceRecords | typeof briefItems,
  ) => updateReturning(tx, table, toPrivate, stillShared(table));

  const releasedMemories = await releaseSimple(memories);
  const releasedFollowups = await releaseSimple(followups);
  const releasedBriefItems = await releaseSimple(briefItems);
  // After the Saved Items and Actions that stood on them are gone, so nothing is
  // left grounded on evidence its household can no longer reach.
  const releasedSourceRecords = await releaseSimple(sourceRecords);

  const releasedGiftPlans = await updateReturning(
    tx,
    giftPlans,
    { ...toPrivate, ...BUMPED_FENCE.giftPlans },
    stillShared(giftPlans),
  );

  const memberOwned = (table: { householdId: PgColumn; scope: PgColumn; ownership: PgColumn }) =>
    and(stillShared(table), eq(table.ownership, "member_owned"));

  const releasedSavedItems = await updateReturning(
    tx,
    savedItems,
    { ...toPrivate, ...BUMPED_FENCE.savedItems },
    memberOwned(savedItems),
  );
  const releasedAssets = await updateReturning(
    tx,
    assets,
    { ...toPrivate, ...BUMPED_FENCE.assets },
    memberOwned(assets),
  );
  const releasedAssetMemories = await updateReturning(
    tx,
    assetMemories,
    { ...toPrivate, ...BUMPED_FENCE.assetMemories },
    memberOwned(assetMemories),
  );
  const releasedGeneralActions = await updateReturning(
    tx,
    generalActions,
    toPrivate,
    memberOwned(generalActions),
  );
  const releasedAssetEvidence = await updateReturning(
    tx,
    assetEvidence,
    toPrivate,
    memberOwned(assetEvidence),
  );

  // A delivery target pointed at a household that no longer exists must fail
  // closed rather than lose only its id: `target_scope` narrows with the link so
  // nothing can read "household delivery, household unknown" as permission.
  await tx
    .update(scheduledWorkflowDeliverySettings)
    .set({ targetHouseholdId: null, targetScope: "private", updatedAt: input.at })
    .where(eq(scheduledWorkflowDeliverySettings.targetHouseholdId, input.householdId));

  return {
    giftPlans: releasedGiftPlans,
    memories: releasedMemories,
    sourceRecords: releasedSourceRecords,
    followups: releasedFollowups,
    generalActions: releasedGeneralActions,
    assets: releasedAssets,
    assetMemories: releasedAssetMemories,
    assetEvidence: releasedAssetEvidence,
    savedItems: releasedSavedItems,
    briefItems: releasedBriefItems,
  };
}

/**
 * The column each fenced family keeps its fence in.
 *
 * Typed against {@link HouseholdPurgeFencedFamily} so a family added to that
 * list fails to compile until its column is named here - the one way to keep a
 * shared constant from becoming a comment the adapter has stopped honouring.
 */
const BUMPED_FENCE: Record<HouseholdPurgeFencedFamily, Record<string, SQL>> = {
  savedItems: { version: sql`${savedItems.version} + 1` },
  giftPlans: { revision: sql`${giftPlans.revision} + 1` },
  assets: { revision: sql`${assets.revision} + 1` },
  assetMemories: { revision: sql`${assetMemories.revision} + 1` },
};

/** Deletes and reports how many rows actually moved, never what they held. */
async function deleteReturning(
  tx: DatabaseExecutor,
  table: PgTable & { id: PgColumn },
  where: SQL | undefined,
): Promise<number> {
  const rows = await tx.delete(table).where(where).returning({ id: table.id });
  return rows.length;
}

async function updateReturning(
  tx: DatabaseExecutor,
  table: PgTable & { id: PgColumn },
  patch: Record<string, unknown>,
  where: SQL | undefined,
): Promise<number> {
  const rows = await tx.update(table).set(patch).where(where).returning({ id: table.id });
  return rows.length;
}
