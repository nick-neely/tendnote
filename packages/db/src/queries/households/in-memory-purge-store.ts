import type {
  HouseholdPurgeFamily,
  HouseholdPurgeStore,
  HouseholdPurgeTombstone,
  HouseholdPurgeTransaction,
  HouseholdReleasedCounts,
  PurgeableHousehold,
} from "./purge";
import { HOUSEHOLD_PURGE_FENCED_FAMILIES } from "./purge";

/**
 * A household modelled closely enough that a wrong disposal order fails.
 *
 * This is a real fake rather than a stub, and the difference is the whole point.
 * The purge's contract is an *order*, and an order can only be proven by
 * something that refuses the wrong one. Pinning the source text of the Drizzle
 * store proved that the statements are written in a sequence; it could not prove
 * that the sequence is the one Postgres will accept, and it would go on passing
 * if the constraint it protects against were misunderstood.
 *
 * So this store carries the two schema facts that decide the order and enforces
 * them the way the database does:
 *
 * - `saved_items.household_id` is `on delete set null`, and
 *   `saved_items_ownership_check` forbids a `household_native` row without a
 *   household. Deleting the workspace while one survives raises here, exactly as
 *   the transaction would abort there.
 * - a child row whose parent is gone is gone with it, so disposing Assets before
 *   their Memories and Evidence loses the children silently rather than counting
 *   them.
 *
 * Everything else about a household is modelled as plain rows, because nothing
 * else about them changes the answer.
 */

/** One stored row, in the only detail the purge's decisions actually turn on. */
type ModelRow = {
  id: string;
  family: ModelFamily;
  householdId: string | null;
  ownership?: "household_native" | "member_owned";
  scope?: "private" | "shared" | "household";
  ownerUserId?: string | null;
  /** Set on Asset Memories and Asset Evidence. */
  assetId?: string;
  /** Set on cached provider events. */
  connectionId?: string;
  /**
   * The optimistic-concurrency counter, for the families that keep one. Named
   * generically because the real schema calls it `version` on Saved Items and
   * `revision` everywhere else, and what the purge owes it is the same either
   * way: a release is a write, so it moves.
   */
  fence?: number;
};

type ModelFamily = HouseholdPurgeFamily | ReleasableFamily;

type ReleasableFamily = keyof HouseholdReleasedCounts;

const RELEASABLE_FAMILIES: readonly ReleasableFamily[] = [
  "giftPlans",
  "memories",
  "sourceRecords",
  "followups",
  "generalActions",
  "assets",
  "assetMemories",
  "assetEvidence",
  "savedItems",
  "briefItems",
];

/** Families whose foreign key to the workspace merely nulls out on delete. */
const SET_NULL_ON_WORKSPACE_DELETE: ReadonlySet<ModelFamily> = new Set<ModelFamily>([
  "savedItems",
  "generalActions",
  "assets",
  "assetMemories",
  "assetEvidence",
  "giftPlans",
  "memories",
  "sourceRecords",
  "followups",
  "briefItems",
]);

const FENCED: ReadonlySet<ModelFamily> = new Set<ModelFamily>(HOUSEHOLD_PURGE_FENCED_FAMILIES);

export class HouseholdPurgeConstraintError extends Error {}

export type SeededHousehold = {
  householdId: string;
  dissolvedAt: Date;
  rows?: readonly Omit<ModelRow, "householdId">[];
};

export type InMemoryHouseholdPurgeStore = HouseholdPurgeStore & {
  /** Every family disposed, in the order the sweep asked for it. */
  disposalOrder: string[];
  tombstones: HouseholdPurgeTombstone[];
  /** The rows still standing, for asserting what survived. */
  rows: () => ModelRow[];
  /** Opens a transaction by hand, so a suite can drive a deliberately wrong order. */
  openTransaction: (householdId: string) => HouseholdPurgeTransaction;
  failOn: Set<string>;
  /** Offers every dissolved household regardless of cutoff, to exercise the re-check. */
  ignoreCutoff: boolean;
};

export function createInMemoryHouseholdPurgeStore(
  households: readonly SeededHousehold[] = [],
): InMemoryHouseholdPurgeStore {
  const remaining = households.map((household) => ({
    householdId: household.householdId,
    dissolvedAt: household.dissolvedAt,
  }));
  let rows: ModelRow[] = households.flatMap((household) =>
    (household.rows ?? []).map((row) => ({ ...row, householdId: household.householdId })),
  );

  const store: InMemoryHouseholdPurgeStore = {
    disposalOrder: [],
    tombstones: [],
    failOn: new Set<string>(),
    ignoreCutoff: false,

    rows: () => [...rows],

    openTransaction(householdId) {
      const mine = (family: ModelFamily) =>
        rows.filter((row) => row.householdId === householdId && row.family === family);
      const remove = (doomed: readonly ModelRow[]) => {
        const ids = new Set(doomed.map((row) => row.id));
        rows = rows.filter((row) => !ids.has(row.id));
        return doomed.length;
      };

      return {
        async collectRemindableRecordIds() {
          return [...mine("savedItems"), ...mine("generalActions")]
            .filter((row) => row.ownership === "household_native")
            .map((row) => row.id);
        },

        async cancelReminders(input) {
          // Modelled as the count of records that had reminders to cancel: what
          // the sweep needs from this seam is that it ran while the records
          // still existed, which the order test asserts directly.
          return input.recordIds.length;
        },

        async dispose(family) {
          store.disposalOrder.push(family);
          if (family === "assetMemories" || family === "assetEvidence") {
            const survivingAssetIds = new Set(mine("assets").map((row) => row.id));
            return remove(
              rows.filter(
                (row) =>
                  row.family === family &&
                  ((row.householdId === householdId && row.ownership === "household_native") ||
                    (row.assetId !== undefined && survivingAssetIds.has(row.assetId))),
              ),
            );
          }
          if (family === "calendarEventCache") {
            const connectionIds = new Set(mine("calendarConnections").map((row) => row.id));
            return remove(
              rows.filter(
                (row) =>
                  row.family === family &&
                  row.connectionId !== undefined &&
                  connectionIds.has(row.connectionId),
              ),
            );
          }
          const owned = mine(family).filter(
            (row) => row.ownership === undefined || row.ownership === "household_native",
          );
          // A parent taking its children with it, which is what makes disposing
          // Assets too early lose the count rather than raise.
          if (family === "assets") {
            const doomedAssetIds = new Set(owned.map((row) => row.id));
            remove(
              rows.filter((row) => row.assetId !== undefined && doomedAssetIds.has(row.assetId)),
            );
          }
          if (family === "calendarConnections") {
            const doomedConnectionIds = new Set(owned.map((row) => row.id));
            remove(
              rows.filter(
                (row) =>
                  row.connectionId !== undefined && doomedConnectionIds.has(row.connectionId),
              ),
            );
          }
          return remove(owned);
        },

        async release() {
          const released = Object.fromEntries(
            RELEASABLE_FAMILIES.map((family) => [family, 0]),
          ) as HouseholdReleasedCounts;
          for (const row of rows) {
            if (row.householdId !== householdId) continue;
            if (row.ownership === "household_native") continue;
            if (!RELEASABLE_FAMILIES.includes(row.family as ReleasableFamily)) continue;
            if (row.scope === "private") continue;
            row.scope = "private";
            row.householdId = null;
            if (FENCED.has(row.family) && row.fence !== undefined) row.fence += 1;
            released[row.family as ReleasableFamily] += 1;
          }
          return released;
        },

        async deleteWorkspace() {
          if (store.failOn.has(householdId)) throw new Error("purge failed");

          // The foreign keys, applied the way the database applies them, and then
          // the check constraint asked the same question Postgres would.
          for (const row of rows) {
            if (row.householdId !== householdId) continue;
            if (SET_NULL_ON_WORKSPACE_DELETE.has(row.family)) {
              row.householdId = null;
            }
          }
          const stranded = rows.find(
            (row) =>
              row.family === "savedItems" &&
              row.ownership === "household_native" &&
              row.householdId === null,
          );
          if (stranded) {
            throw new HouseholdPurgeConstraintError(
              'new row for relation "saved_items" violates check constraint "saved_items_ownership_check"',
            );
          }
          rows = rows.filter((row) => row.householdId !== householdId);
          const index = remaining.findIndex((household) => household.householdId === householdId);
          if (index >= 0) remaining.splice(index, 1);
        },

        async writeTombstone(tombstone) {
          store.tombstones.push(tombstone);
        },
      };
    },

    async listPurgeableHouseholds(query) {
      return remaining
        .filter((household) => store.ignoreCutoff || household.dissolvedAt <= query.cutoff)
        .sort((left, right) => left.dissolvedAt.getTime() - right.dissolvedAt.getTime())
        .slice(0, query.limit);
    },

    async purgeHousehold(input, erase) {
      // The atomic scope, modelled honestly: a failure part-way through leaves
      // the household exactly as it was, which is what makes the sweep safe to
      // re-run rather than merely idempotent in the happy case.
      const snapshotRows = rows.map((row) => ({ ...row }));
      const snapshotOrder = [...store.disposalOrder];
      const snapshotTombstones = [...store.tombstones];
      try {
        return await erase(store.openTransaction(input.householdId));
      } catch (error) {
        rows = snapshotRows;
        store.disposalOrder = snapshotOrder;
        store.tombstones = snapshotTombstones;
        throw error;
      }
    },
  };

  return store;
}
