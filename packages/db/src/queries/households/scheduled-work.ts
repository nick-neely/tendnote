import { and, eq, inArray, ne } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { DatabaseExecutor } from "../../client";
import { getDb } from "../../client";
import {
  assetEvidence,
  assetMemories,
  assets,
  generalActions,
  reminderDeliveryJobs,
  reminderOccurrenceIntents,
  reminderSchedules,
} from "../../schema";

/**
 * What ending someone's place in a household has to do to the work that was
 * scheduled around them.
 *
 * A narrow, purpose-built seam rather than the General Action and reminder
 * stores handed to governance wholesale, because governance has no business
 * reading or writing records generally — it needs exactly these four effects,
 * all of them consequences of access ending, and all of them obliged to happen
 * inside the same transaction as the membership change. A departure that
 * revoked sharing but left a queued alert is a window in which the household
 * and the person disagree about whether they still live together.
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
    async listHouseholdActionIds() {
      return [];
    },
    async cancelRemindersForRecords() {
      return 0;
    },
  };
}
