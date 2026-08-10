import {
  type AssetMemoryValue,
  assetMemorySchema,
  assetMemoryUpdateSchema,
  assetReviewGroupSchema,
  createAssetMemorySchema,
  createAssetReviewGroupSchema,
} from "@tendnote/domain";
import { and, asc, desc, eq, exists, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import { assetMemories, assetReviewGroups, assets } from "../../schema";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import type { AssetReviewStore } from "./review-types";

// Aliased so the scope-visibility predicate can reference the row as `am`,
// matching the alias the shared `visibleHouseholdRecordSql` builder expects.
const visibleMemories = alias(assetMemories, "am");

// Shared ordering contract: oldest first, id tiebreak — a stable ledger of facts.
// The in-memory store's `byCreatedThenId` mirrors this; keep the two in step.
const memoryOrder = [asc(assetMemories.createdAt), asc(assetMemories.id)];

/** Maps a raw row (value_json → value) into the domain shape before parsing. */
function parseMemoryRow(row: typeof assetMemories.$inferSelect) {
  const { valueJson, ...rest } = row;
  return assetMemorySchema.parse({ ...rest, value: valueJson });
}

/** Maps a domain memory write (value → value_json) into column values. */
function toMemoryColumns<T extends { value?: AssetMemoryValue | null }>(
  values: T,
): Omit<T, "value"> & { valueJson?: AssetMemoryValue | null } {
  const { value, ...rest } = values;
  return { ...rest, ...(value !== undefined ? { valueJson: value } : {}) };
}

/**
 * Drizzle-backed Asset Memory + Asset Review Group store (#198). Every method is
 * owner-keyed except `listVisibleAssetMemoriesForAsset`, which applies the shared
 * per-record scope predicate to *active* memories only — suggested and dismissed
 * rows are owner-only review state, mirroring the durable-status rule on assets.
 */
export function createDrizzleAssetReviewStore(): AssetReviewStore {
  return {
    async createAssetMemory(values) {
      const [row] = await getDb()
        .insert(assetMemories)
        .values(toMemoryColumns(createAssetMemorySchema.parse(values)))
        .returning();
      if (!row) {
        throw new Error("Failed to create asset memory.");
      }
      return parseMemoryRow(row);
    },
    async getAssetMemory(input) {
      const [row] = await getDb()
        .select()
        .from(assetMemories)
        .where(
          and(
            eq(assetMemories.id, input.memoryId),
            eq(assetMemories.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);
      return row ? parseMemoryRow(row) : null;
    },
    async getVisibleAssetMemory(input) {
      const [row] = await getDb()
        .select()
        .from(visibleMemories)
        .where(
          and(
            eq(visibleMemories.id, input.memoryId),
            // Active only: review state is never a scope-visible read.
            eq(visibleMemories.status, "active"),
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "am",
              recordKind: "asset_memory",
            }),
          ),
        )
        .limit(1);
      return row ? parseMemoryRow(row) : null;
    },
    async updateAssetMemory(input) {
      // Defaults-free patch parse, like the asset store: an absent key stays
      // absent so a status-only patch never wipes content or scope columns.
      const patch = assetMemoryUpdateSchema.parse(input.patch);
      const [row] = await getDb()
        .update(assetMemories)
        // The fence is bumped in SQL rather than read-then-written, so two
        // concurrent writers can never land on the same revision (#386).
        .set({
          ...toMemoryColumns(patch),
          revision: sql`${assetMemories.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(assetMemories.id, input.memoryId),
            eq(assetMemories.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();
      if (!row) {
        throw new Error("Asset memory not found.");
      }
      return parseMemoryRow(row);
    },
    async listAssetMemoriesForOwner(input) {
      const rows = await getDb()
        .select()
        .from(assetMemories)
        .where(
          and(
            eq(assetMemories.ownerUserId, input.ownerUserId),
            ...(input.assetId !== undefined ? [eq(assetMemories.assetId, input.assetId)] : []),
            ...(input.reviewGroupId !== undefined
              ? [eq(assetMemories.reviewGroupId, input.reviewGroupId)]
              : []),
            ...(input.statuses && input.statuses.length > 0
              ? [inArray(assetMemories.status, input.statuses)]
              : []),
          ),
        )
        .orderBy(...memoryOrder);
      return rows.map((row) => parseMemoryRow(row));
    },
    async listVisibleAssetMemoriesForAsset(input) {
      // Per-record scope filtering, pre-retrieval: each detail is filtered
      // independently of its asset, so a household asset can hold a private
      // detail its members never see (#196). Active rows only — review state
      // never rides a visible read.
      const rows = await getDb()
        .select()
        .from(visibleMemories)
        .where(
          and(
            eq(visibleMemories.assetId, input.assetId),
            eq(visibleMemories.status, "active"),
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "am",
              recordKind: "asset_memory",
            }),
          ),
        )
        .orderBy(asc(visibleMemories.createdAt), asc(visibleMemories.id));
      return rows.map((row) => parseMemoryRow(row));
    },
    async createAssetReviewGroup(values) {
      const [row] = await getDb()
        .insert(assetReviewGroups)
        .values(createAssetReviewGroupSchema.parse(values))
        .returning();
      if (!row) {
        throw new Error("Failed to create asset review group.");
      }
      return assetReviewGroupSchema.parse(row);
    },
    async getAssetReviewGroup(input) {
      const [row] = await getDb()
        .select()
        .from(assetReviewGroups)
        .where(
          and(
            eq(assetReviewGroups.id, input.groupId),
            eq(assetReviewGroups.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);
      return row ? assetReviewGroupSchema.parse(row) : null;
    },
    async getAssetReviewGroupByAsset(input) {
      const [row] = await getDb()
        .select()
        .from(assetReviewGroups)
        .where(
          and(
            eq(assetReviewGroups.assetId, input.assetId),
            eq(assetReviewGroups.ownerUserId, input.ownerUserId),
          ),
        )
        .orderBy(desc(assetReviewGroups.createdAt))
        .limit(1);
      return row ? assetReviewGroupSchema.parse(row) : null;
    },
    async updateAssetReviewGroupAsset(input) {
      const [row] = await getDb()
        .update(assetReviewGroups)
        .set({ assetId: input.assetId })
        .where(
          and(
            eq(assetReviewGroups.id, input.groupId),
            eq(assetReviewGroups.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();
      if (!row) {
        throw new Error("Asset review group not found.");
      }
      return assetReviewGroupSchema.parse(row);
    },
    async listPendingAssetReviewGroupsForOwner(input) {
      const db = getDb();
      // A group is pending while it still has a reviewable member: its own
      // suggested anchor row, or a suggested memory it groups. Resolved groups
      // drop out of the queue; their records keep the group id for provenance.
      const pendingAnchor = exists(
        db
          .select({ one: assets.id })
          .from(assets)
          .where(
            and(
              eq(assets.id, assetReviewGroups.assetId),
              eq(assets.ownerUserId, assetReviewGroups.ownerUserId),
              eq(assets.status, "suggested"),
            ),
          ),
      );
      const pendingMemory = exists(
        db
          .select({ one: assetMemories.id })
          .from(assetMemories)
          .where(
            and(
              eq(assetMemories.reviewGroupId, assetReviewGroups.id),
              eq(assetMemories.ownerUserId, assetReviewGroups.ownerUserId),
              eq(assetMemories.status, "suggested"),
            ),
          ),
      );

      const query = db
        .select()
        .from(assetReviewGroups)
        .where(
          and(
            eq(assetReviewGroups.ownerUserId, input.ownerUserId),
            or(pendingAnchor, pendingMemory),
          ),
        )
        // Newest first: the queue leads with the latest capture context.
        .orderBy(desc(assetReviewGroups.createdAt), desc(assetReviewGroups.id));

      const rows = await (input.limit === undefined ? query : query.limit(input.limit));
      return rows.map((row) => assetReviewGroupSchema.parse(row));
    },
  };
}
