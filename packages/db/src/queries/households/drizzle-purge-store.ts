import { and, asc, eq, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
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
  HouseholdDisposedCounts,
  HouseholdPurgeCounts,
  HouseholdPurgeStore,
  HouseholdReleasedCounts,
} from "./purge";
import { householdPurgeTombstone } from "./purge";
import { createDrizzleHouseholdScheduledWorkStore } from "./scheduled-work";

/**
 * The erasure itself, family by family, in the one order every constraint
 * allows.
 *
 * The order is not stylistic. Four things in the schema decide it, and getting
 * any of them wrong is a runtime failure or a silent leak rather than a lint:
 *
 * 1. `saved_items.household_id` is `on delete set null`, and
 *    `saved_items_ownership_check` forbids a `household_native` row without a
 *    household. Deleting the workspace row while one household-native Saved Item
 *    survives therefore does not orphan the row — it aborts the whole
 *    transaction on a check violation. Every household-native Saved Item must be
 *    gone *first*. (`general_actions` and `assets` have no equivalent check, so
 *    the same mistake there fails silently instead, leaving a `household_native`
 *    row with a null household that no proof can ever authorize. Same rule,
 *    quieter failure.)
 * 2. `saved_items.source_record_id` is `on delete restrict`, so a Saved Item
 *    always precedes anything done to its Source Record. Nothing here deletes a
 *    Source Record — they are somebody's capture and come home instead — but the
 *    ordering matters for the release below, which must not run against rows a
 *    later delete still needs.
 * 3. Asset children cascade off their Asset, and Reminder Schedules cascade off
 *    a General Action but *not* off a Saved Item: `reminder_schedules.record_id`
 *    is a bare uuid with no foreign key. So the reminder sweep must run against
 *    the collected record ids before those records are deleted, or a Saved Item
 *    reminder outlives the item and the household both.
 * 4. Everything keyed to the workspace by a cascading foreign key — memberships,
 *    shares, invitations, connections, Event Plans, Person References,
 *    dissolution confirmations, household-subject Context Facts — would go with
 *    the workspace row anyway. They are deleted explicitly regardless, because a
 *    sweep whose inventory is "whatever the database happens to cascade" cannot
 *    report what it removed and cannot be read as a list of what a household is
 *    made of.
 *
 * What is deliberately *not* deleted: anything member-owned. Those rows are
 * released — returned to `private` with their household link cleared — because a
 * household never owned them and because the FK's own `set null` would otherwise
 * leave a `household`-scope record pointing at nothing, readable by nobody
 * including the person who wrote it.
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

    async purgeHousehold(input) {
      const executor = resolveDb();
      // `transaction` exists on the pooled database and not on an already-open
      // transaction, so a caller that hands one in has already opened the scope
      // this needs and the work runs directly against it.
      const run = (tx: DatabaseExecutor) => purgeWithin(tx, input);
      return "transaction" in executor ? executor.transaction(run) : run(executor);
    },
  };
}

async function purgeWithin(
  tx: DatabaseExecutor,
  input: { householdId: string; dissolvedAt: Date; purgedAt: Date },
): Promise<HouseholdPurgeCounts> {
  const householdId = input.householdId;

  // Step 1. The workspace's own records, collected before anything is removed.
  // Their ids are what the reminder sweep needs, and a Saved Item's reminders
  // have no foreign key to follow once the item is gone.
  const householdNativeIds = async (
    table: typeof savedItems | typeof generalActions | typeof assets,
  ) =>
    (
      await tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.householdId, householdId), eq(table.ownership, "household_native")))
    ).map((row) => row.id);

  const savedItemIds = await householdNativeIds(savedItems);
  const actionIds = await householdNativeIds(generalActions);
  const assetIds = await householdNativeIds(assets);

  // Step 2. Every schedule, pending intent, and queued delivery standing on one
  // of those records, for every member who ever subscribed. Reused rather than
  // rewritten: this is the same cancellation a departure performs, and two
  // implementations of "these reminders end now" would be two chances to
  // disagree about what that means.
  const scheduledWork = createDrizzleHouseholdScheduledWorkStore(() => tx);
  const canceledReminders = await scheduledWork.cancelRemindersForRecords({
    recordIds: [...savedItemIds, ...actionIds],
    at: input.purgedAt,
  });

  // Step 3. The records themselves, children before parents.
  //
  // Asset children are matched by parent as well as by ownership: a member's own
  // note on the household's refrigerator is member-owned, and it cannot be
  // released instead, because an Asset detail with no Asset is not a record
  // anyone can read. The cascade would remove it either way; matching it here is
  // what lets the trail count it rather than lose it silently.
  const belongsToDisposedAsset = (table: typeof assetMemories | typeof assetEvidence) =>
    assetIds.length > 0
      ? or(
          and(eq(table.householdId, householdId), eq(table.ownership, "household_native")),
          inArray(table.assetId, assetIds),
        )
      : and(eq(table.householdId, householdId), eq(table.ownership, "household_native"));

  const disposedAssetEvidence = await deleteReturning(
    tx,
    assetEvidence,
    belongsToDisposedAsset(assetEvidence),
  );
  const disposedAssetMemories = await deleteReturning(
    tx,
    assetMemories,
    belongsToDisposedAsset(assetMemories),
  );
  const disposedAssets =
    assetIds.length > 0 ? await deleteReturning(tx, assets, inArray(assets.id, assetIds)) : 0;
  const disposedSavedItems =
    savedItemIds.length > 0
      ? await deleteReturning(tx, savedItems, inArray(savedItems.id, savedItemIds))
      : 0;
  const disposedGeneralActions =
    actionIds.length > 0
      ? await deleteReturning(tx, generalActions, inArray(generalActions.id, actionIds))
      : 0;

  // Step 4. Everything the workspace is made of, named rather than cascaded.
  const disposedEventPlans = await deleteReturning(
    tx,
    householdEventPlans,
    eq(householdEventPlans.householdId, householdId),
  );
  const disposedCalendarConnections = await deleteReturning(
    tx,
    householdCalendarConnections,
    eq(householdCalendarConnections.householdId, householdId),
  );
  const disposedPersonReferences = await deleteReturning(
    tx,
    personReferences,
    eq(personReferences.householdId, householdId),
  );
  const disposedContextFacts = await deleteReturning(
    tx,
    contextFacts,
    eq(contextFacts.subjectHouseholdId, householdId),
  );
  const disposedInvitations = await deleteReturning(
    tx,
    householdInvitations,
    eq(householdInvitations.householdId, householdId),
  );
  const disposedRecordShares = await deleteReturning(
    tx,
    householdRecordShares,
    eq(householdRecordShares.householdId, householdId),
  );
  await deleteReturning(
    tx,
    householdDissolutionConfirmations,
    eq(householdDissolutionConfirmations.householdId, householdId),
  );
  const disposedMemberships = await deleteReturning(
    tx,
    householdMemberships,
    eq(householdMemberships.householdId, householdId),
  );

  // Step 5. Whatever member-owned rows are still pointing at this household come
  // home. Dissolution already did this for most families inside its own
  // transaction; Gift Plans are privatized by a best-effort post-commit hook,
  // and a Source Record grounding a household-native record is held back on
  // purpose so the workspace's own record stays readable right up until it is
  // gone. This is the last safe point for all of them.
  const released = await releaseMemberOwnedRecords(tx, { householdId, at: input.purgedAt });

  // Step 6. The workspace row, and the tombstone that outlives it.
  await tx.delete(householdWorkspaces).where(eq(householdWorkspaces.id, householdId));

  const disposed: HouseholdDisposedCounts = {
    savedItems: disposedSavedItems,
    generalActions: disposedGeneralActions,
    assets: disposedAssets,
    assetMemories: disposedAssetMemories,
    assetEvidence: disposedAssetEvidence,
    eventPlans: disposedEventPlans,
    contextFacts: disposedContextFacts,
    personReferences: disposedPersonReferences,
    invitations: disposedInvitations,
    calendarConnections: disposedCalendarConnections,
    recordShares: disposedRecordShares,
    memberships: disposedMemberships,
    canceledReminders,
  };
  const counts: HouseholdPurgeCounts = { disposed, released };

  const tombstone = householdPurgeTombstone({
    householdId,
    dissolvedAt: input.dissolvedAt,
    purgedAt: input.purgedAt,
    counts,
  });
  // Written through the table rather than the household store's audit helper,
  // which requires a member id: this entry has no actor by design, and the
  // scrubbed system form is exactly what the privacy evidence allows.
  await tx.insert(auditLog).values({
    ownerUserId: tombstone.ownerUserId,
    action: tombstone.action,
    entityType: tombstone.entityType,
    entityId: tombstone.entityId,
    metadataJson: tombstone.metadataJson,
    createdAt: input.purgedAt,
  });

  return counts;
}

/**
 * Returns member-owned rows still pointing at this household to `private`.
 *
 * `ne(scope, "private")` on every family, so a row that already came home is not
 * counted twice by a re-run — the sweep is bounded per household, but the
 * release predicate is the part that has to be idempotent on its own terms.
 */
async function releaseMemberOwnedRecords(
  tx: DatabaseExecutor,
  input: { householdId: string; at: Date },
): Promise<HouseholdReleasedCounts> {
  const toPrivate = { scope: "private" as const, householdId: null, updatedAt: input.at };
  const stillShared = (table: { householdId: PgColumn; scope: PgColumn }) =>
    and(eq(table.householdId, input.householdId), ne(table.scope, "private"));

  const releaseSimple = async (
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
    // Gift Plans carry a revision fence rather than a version counter, and every
    // write bumps it so a co-planner holding the pre-purge revision reconciles
    // instead of saving over a plan that has since left the household.
    { ...toPrivate, revision: sql`${giftPlans.revision} + 1` },
    stillShared(giftPlans),
  );
  const releasedSavedItems = await updateReturning(
    tx,
    savedItems,
    { ...toPrivate, version: sql`${savedItems.version} + 1` },
    and(stillShared(savedItems), eq(savedItems.ownership, "member_owned")),
  );

  const releaseOwned = async (
    table: typeof generalActions | typeof assets | typeof assetMemories | typeof assetEvidence,
  ) =>
    updateReturning(
      tx,
      table,
      toPrivate,
      and(stillShared(table), eq(table.ownership, "member_owned")),
    );

  const releasedGeneralActions = await releaseOwned(generalActions);
  const releasedAssets = await releaseOwned(assets);
  const releasedAssetMemories = await releaseOwned(assetMemories);
  const releasedAssetEvidence = await releaseOwned(assetEvidence);

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

/** Deletes and reports how many rows actually moved, never what they held. */
async function deleteReturning(
  tx: DatabaseExecutor,
  table: PgTable & { id: PgColumn },
  where: ReturnType<typeof eq> | undefined,
): Promise<number> {
  const rows = await tx.delete(table).where(where).returning({ id: table.id });
  return rows.length;
}

async function updateReturning(
  tx: DatabaseExecutor,
  table: PgTable & { id: PgColumn },
  patch: Record<string, unknown>,
  where: ReturnType<typeof eq> | undefined,
): Promise<number> {
  const rows = await tx.update(table).set(patch).where(where).returning({ id: table.id });
  return rows.length;
}
