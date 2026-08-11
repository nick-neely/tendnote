import { and, eq, exists, inArray, ne, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { DatabaseExecutor } from "../../client";
import { getDb } from "../../client";
import {
  assetEvidence,
  assetMemories,
  assets,
  followups,
  generalActions,
  memories,
  reminderDeliveryJobs,
  reminderOccurrenceIntents,
  reminderSchedules,
  savedItems,
  sourceRecords,
} from "../../schema";

/**
 * What ending someone's place in a household has to do to the work that was
 * scheduled around them.
 *
 * A narrow, purpose-built seam rather than the record and reminder stores handed
 * to governance wholesale, because governance has no business reading or writing
 * records generally — it needs exactly the effects below, all of them
 * consequences of access ending, and all of them obliged to happen inside the
 * same transaction as the membership change. A departure that revoked sharing
 * but left a queued alert is a window in which the household and the person
 * disagree about whether they still live together.
 *
 * The reverts are one rule applied family by family rather than one generic
 * sweep, because the families genuinely differ: some have a household-native
 * form that must survive the departure, one has a parent whose scope is a
 * ceiling, and one is evidence that other people's surviving records stand on.
 * A single "set every household-scoped row of this owner to private" would get
 * each of those wrong in a different way.
 *
 * Deliberately id-returning rather than record-returning: governance decides
 * *that* these things end, and nothing here gives it a way to read their
 * content.
 */
export type HouseholdScheduledWorkStore = {
  /**
   * Clears every household-native record naming this member as looking after
   * it, and names no replacement — Tendnote never chooses one (ADR 0215).
   */
  clearResponsibilityHolderForMember: (input: {
    householdId: string;
    userId: string;
  }) => Promise<string[]>;
  /**
   * Returns this member's own shared and household-scope Actions to `private`.
   *
   * A departure ends access, not ownership: what someone wrote is still theirs
   * and leaves with them. Without this the record would keep `household` scope
   * while its owner had no membership — visible to everyone still in the
   * household and, because the scope rule needs active membership, invisible to
   * the person who actually owns it.
   */
  revertMemberOwnedActionsToPrivate: (input: {
    householdId: string;
    ownerUserId: string;
  }) => Promise<string[]>;
  /**
   * The same for this member's own Assets — and, in the same sweep, their own
   * Asset Memories and Asset Evidence in this household.
   *
   * The children are not an afterthought. An Asset's scope is the ceiling for
   * every record hanging off it (ADR 0179), so returning the Asset to `private`
   * while leaving a `household` memory on it would leave the child above its
   * parent and still readable by the household the owner just left — the exact
   * shape of leak the revert exists to close. Their details on records that are
   * *not* theirs come home too: a note this member widened to the household is
   * their sharing, and their sharing ends with their access. So does the mirror
   * case — a *remaining* member's detail on the Asset that just went home, which
   * would otherwise be left above a parent nobody in the household can reach.
   *
   * Household-native Assets and their household-native children are deliberately
   * untouched: those belong to the workspace and stay, with this member's
   * creator and actor attribution intact (ADR 0214).
   *
   * Returns the reverted Asset ids only — governance counts what moved and is
   * given no way to read what any of it says.
   */
  revertMemberOwnedAssetsToPrivate: (input: {
    householdId: string;
    ownerUserId: string;
  }) => Promise<string[]>;
  /**
   * The same for this member's own Saved Items.
   *
   * `docs/phase-8/household-saved-items.md` states it twice — a member-owned
   * item "immediately returns to their private space" on departure, removal, or
   * dissolution — and until this existed the code did neither half: the item
   * kept `household` scope, so the household read on, and the audience rule
   * needs current active membership before it consults ownership, so the person
   * who wrote it was refused their own note. Exactly the shape of the Action and
   * Asset reverts beside it.
   *
   * Household-native Saved Items are untouched: they belong to the workspace and
   * survive every departure with their creator and actor attribution intact
   * (ADR 0214).
   */
  revertMemberOwnedSavedItemsToPrivate: (input: {
    householdId: string;
    ownerUserId: string;
  }) => Promise<string[]>;
  /**
   * The same for the relationship records this member deliberately exposed to
   * the household — their own Memories, Source Records, and Follow-Ups (#388).
   *
   * These have no household-native form at all: every row is somebody's, so a
   * departure returns all of them. Dropping the share rows is not enough on its
   * own and never was, because a `household`-scope record has no share rows to
   * drop; it is readable by anyone with a current active membership, which after
   * a departure means everyone except its owner.
   *
   * Source Records are the one family that needs an exclusion, and it is the
   * evidence-ceiling rule seen from the other side. A household-native Saved
   * Item, Action, Asset Memory, or Asset Evidence stands on grounding that is
   * still keyed to whichever member captured it, and that record survives the
   * departure — so returning its evidence to `private` would leave the
   * workspace's own record grounded on something nobody in the household can
   * read. Those source records stay where they are; every other one comes home.
   *
   * Returns the ids per family, so the audit trail can say how much of each
   * moved and still be given no way to read any of it.
   */
  revertMemberOwnedRelationshipRecordsToPrivate: (input: {
    householdId: string;
    ownerUserId: string;
  }) => Promise<{ memories: string[]; sourceRecords: string[]; followups: string[] }>;
  /**
   * The ids of the Actions and Routines currently scoped to this household.
   *
   * Deliberately every ownership form, not only the workspace's own. Someone
   * leaving must lose their alerts about a partner's shared errand as well as
   * about the household's chores — both are records they can no longer see.
   * Their *own* records are excluded by having already been returned to
   * `private`, which is why the revert runs first.
   */
  listHouseholdActionIds: (input: { householdId: string }) => Promise<string[]>;
  /**
   * Cancels Reminder Schedules and pending intents for these records.
   *
   * `userIds` narrows it to the people losing access, which is what a single
   * departure means; omitting it cancels for everyone, which is what dissolution
   * means. Returns the number of schedules removed, so the audit trail can say
   * how much was actually standing.
   */
  cancelRemindersForRecords: (input: {
    recordIds: readonly string[];
    userIds?: readonly string[];
    at: Date;
  }) => Promise<number>;
};

export function createDrizzleHouseholdScheduledWorkStore(
  resolveDb: () => DatabaseExecutor = getDb,
): HouseholdScheduledWorkStore {
  return {
    async clearResponsibilityHolderForMember(input) {
      const rows = await resolveDb()
        .update(generalActions)
        .set({ responsibilityHolderUserId: null, updatedAt: new Date() })
        .where(
          and(
            eq(generalActions.householdId, input.householdId),
            eq(generalActions.responsibilityHolderUserId, input.userId),
          ),
        )
        .returning({ id: generalActions.id });
      return rows.map((row) => row.id);
    },

    async revertMemberOwnedActionsToPrivate(input) {
      const rows = await resolveDb()
        .update(generalActions)
        .set({ scope: "private", householdId: null, updatedAt: new Date() })
        .where(
          and(
            eq(generalActions.householdId, input.householdId),
            eq(generalActions.ownerUserId, input.ownerUserId),
            eq(generalActions.ownership, "member_owned"),
            ne(generalActions.scope, "private"),
          ),
        )
        .returning({ id: generalActions.id });
      return rows.map((row) => row.id);
    },

    async revertMemberOwnedAssetsToPrivate(input) {
      const db = resolveDb();
      const now = new Date();
      const toPrivate = { scope: "private" as const, householdId: null, updatedAt: now };

      // Children first, then the parent. Either order leaves the pair briefly
      // inconsistent inside the transaction, and this one is the safe
      // inconsistency: a private child under a still-household parent is simply
      // narrower than its ceiling, which is always allowed. The reverse — a
      // private parent with a household child — is the state ADR 0179 forbids.
      for (const table of [assetMemories, assetEvidence]) {
        await db
          .update(table)
          .set(toPrivate)
          .where(
            and(
              eq(table.householdId, input.householdId),
              eq(table.ownerUserId, input.ownerUserId),
              eq(table.ownership, "member_owned"),
              ne(table.scope, "private"),
            ),
          );
      }

      const rows = await db
        .update(assets)
        .set(toPrivate)
        .where(
          and(
            eq(assets.householdId, input.householdId),
            eq(assets.ownerUserId, input.ownerUserId),
            eq(assets.ownership, "member_owned"),
            ne(assets.scope, "private"),
          ),
        )
        .returning({ id: assets.id });

      // The other half of the ceiling, and the one that is easy to miss: a
      // *remaining* member's detail on the Asset that just went home.
      //
      // Attaching a detail only ever needed visibility of the Asset, so a
      // partner's household-scope note can be sitting on the departing member's
      // car. Reverting only the departing member's own rows would leave that
      // note at `household` scope under a now-private parent — above its ceiling,
      // still readable by the household, and about a record nobody in that
      // household can reach any more. Its owner keeps it; it simply stops being
      // shared, exactly as it would have if they had narrowed the parent
      // themselves.
      if (rows.length > 0) {
        const revertedAssetIds = rows.map((row) => row.id);
        for (const table of [assetMemories, assetEvidence]) {
          await db
            .update(table)
            .set(toPrivate)
            // No ownership filter, and that is not an omission: a
            // household-native child is only legal under a household-native
            // Asset, so every child of a member-owned one is member-owned.
            .where(and(inArray(table.assetId, revertedAssetIds), ne(table.scope, "private")));
        }
      }

      return rows.map((row) => row.id);
    },

    async revertMemberOwnedSavedItemsToPrivate(input) {
      const rows = await resolveDb()
        .update(savedItems)
        .set({
          scope: "private",
          householdId: null,
          // Every Saved Item write bumps the concurrency fence, and this is a
          // write. A member still holding the pre-departure version is then
          // reconciled rather than allowed to save over a record that has since
          // left the household (#385).
          version: sql`${savedItems.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(savedItems.householdId, input.householdId),
            eq(savedItems.ownerUserId, input.ownerUserId),
            eq(savedItems.ownership, "member_owned"),
            ne(savedItems.scope, "private"),
          ),
        )
        .returning({ id: savedItems.id });
      return rows.map((row) => row.id);
    },

    async revertMemberOwnedRelationshipRecordsToPrivate(input) {
      const db = resolveDb();
      const toPrivate = { scope: "private" as const, householdId: null, updatedAt: new Date() };
      const ownRowsInThisHousehold = (table: typeof memories | typeof followups) =>
        and(
          eq(table.householdId, input.householdId),
          eq(table.ownerUserId, input.ownerUserId),
          ne(table.scope, "private"),
        );

      const revertedMemories = await db
        .update(memories)
        .set(toPrivate)
        .where(ownRowsInThisHousehold(memories))
        .returning({ id: memories.id });
      const revertedFollowups = await db
        .update(followups)
        .set(toPrivate)
        .where(ownRowsInThisHousehold(followups))
        .returning({ id: followups.id });

      // The grounding the household's own records stand on stays put. Each of
      // these families keeps its capturer in `owner_user_id` as a storage key
      // while the record itself belongs to the workspace (ADR 0214), so the
      // owner match alone cannot tell "evidence I shared" from "evidence the
      // household's record is made of".
      const groundsSurvivingHouseholdRecord = or(
        exists(
          db
            .select({ one: sql`1` })
            .from(savedItems)
            .where(
              and(
                eq(savedItems.sourceRecordId, sourceRecords.id),
                eq(savedItems.ownership, "household_native"),
              ),
            ),
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(generalActions)
            .where(
              and(
                eq(generalActions.sourceRecordId, sourceRecords.id),
                eq(generalActions.ownership, "household_native"),
              ),
            ),
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(assetMemories)
            .where(
              and(
                eq(assetMemories.sourceRecordId, sourceRecords.id),
                eq(assetMemories.ownership, "household_native"),
              ),
            ),
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(assetEvidence)
            .where(
              and(
                eq(assetEvidence.sourceRecordId, sourceRecords.id),
                eq(assetEvidence.ownership, "household_native"),
              ),
            ),
        ),
      );

      const revertedSourceRecords = await db
        .update(sourceRecords)
        .set(toPrivate)
        .where(
          and(
            eq(sourceRecords.householdId, input.householdId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
            ne(sourceRecords.scope, "private"),
            sql`not (${groundsSurvivingHouseholdRecord})`,
          ),
        )
        .returning({ id: sourceRecords.id });

      return {
        memories: revertedMemories.map((row) => row.id),
        sourceRecords: revertedSourceRecords.map((row) => row.id),
        followups: revertedFollowups.map((row) => row.id),
      };
    },

    async listHouseholdActionIds(input) {
      const rows = await resolveDb()
        .select({ id: generalActions.id })
        .from(generalActions)
        .where(eq(generalActions.householdId, input.householdId));
      return rows.map((row) => row.id);
    },

    async cancelRemindersForRecords(input) {
      if (input.recordIds.length === 0) return 0;
      const recordIds = [...input.recordIds];
      const userIds = input.userIds ? [...input.userIds] : null;
      const scopedTo = (column: PgColumn) => (userIds ? [inArray(column, userIds)] : []);

      const db = resolveDb();
      // Delivery jobs first, then intents, then the schedules they hang off:
      // each step removes the rows that would otherwise be orphaned by the next,
      // so a failure part-way through leaves nothing pointing at a schedule that
      // is gone.
      const intents = await db
        .select({ id: reminderOccurrenceIntents.id })
        .from(reminderOccurrenceIntents)
        .where(
          and(
            inArray(reminderOccurrenceIntents.recordId, recordIds),
            ...scopedTo(reminderOccurrenceIntents.ownerUserId),
          ),
        );
      if (intents.length > 0) {
        await db.delete(reminderDeliveryJobs).where(
          inArray(
            reminderDeliveryJobs.occurrenceIntentId,
            intents.map((intent) => intent.id),
          ),
        );
        await db.delete(reminderOccurrenceIntents).where(
          inArray(
            reminderOccurrenceIntents.id,
            intents.map((intent) => intent.id),
          ),
        );
      }
      const removed = await db
        .delete(reminderSchedules)
        .where(
          and(
            inArray(reminderSchedules.recordId, recordIds),
            ...scopedTo(reminderSchedules.ownerUserId),
          ),
        )
        .returning({ id: reminderSchedules.id });
      return removed.length;
    },
  };
}

/**
 * The no-op form, for the governance suite and any composition that has no
 * scheduled work to end.
 *
 * Deliberately inert rather than a fake store: governance's own tests are about
 * which rows move and in what order, and a second implementation of these
 * effects would be a second place for the departure contract to drift. The
 * effects themselves are asserted against the Drizzle store and against the
 * General Action lifecycle, which is where they actually live.
 */
export function createNoopHouseholdScheduledWorkStore(): HouseholdScheduledWorkStore {
  return {
    async clearResponsibilityHolderForMember() {
      return [];
    },
    async revertMemberOwnedActionsToPrivate() {
      return [];
    },
    async revertMemberOwnedAssetsToPrivate() {
      return [];
    },
    async revertMemberOwnedSavedItemsToPrivate() {
      return [];
    },
    async revertMemberOwnedRelationshipRecordsToPrivate() {
      return { memories: [], sourceRecords: [], followups: [] };
    },
    async listHouseholdActionIds() {
      return [];
    },
    async cancelRemindersForRecords() {
      return 0;
    },
  };
}
