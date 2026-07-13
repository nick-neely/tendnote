import {
  assetAuditEventSchema,
  assetSchema,
  assetUpdateSchema,
  createAssetAuditEventSchema,
  createAssetSchema,
} from "@tendnote/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import { assetAuditEvents, assets } from "../../schema";
import { createDrizzleHouseholdStore } from "../households/drizzle-store";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import type { AssetLifecycleStore, AssetStore } from "./types";

// Aliased so the scope-visibility predicate can reference the row as `a`, matching
// the alias the shared `visibleHouseholdRecordSql` builder expects.
const visibleAssets = alias(assets, "a");

// Shared ordering contract: case-insensitive name ascending — a browsable ledger,
// not a feed — with most-recently-created breaking ties. The in-memory store's
// `byNameThenCreated` mirrors this expression; keep the two in step.
const nameOrder = [sql`lower(${visibleAssets.name}) asc`, desc(visibleAssets.createdAt)];

/**
 * Drizzle-backed Asset CRUD + internal-audit store. Owner scoping is enforced in
 * every owner-keyed predicate so a caller can only read or mutate their own
 * assets; the `Visible` reads apply the shared Phase 4 scope predicate so
 * household and selected-shared assets surface to exactly the members who may see
 * them (AGENTS.md owner-scoped seams; ADR 0153).
 */
export function createDrizzleAssetStore(): AssetStore {
  return {
    async createAsset(values) {
      const [asset] = await getDb()
        .insert(assets)
        .values(createAssetSchema.parse(values))
        .returning();
      if (!asset) {
        throw new Error("Failed to create asset.");
      }
      return assetSchema.parse(asset);
    },
    async getAsset(input) {
      const [asset] = await getDb()
        .select()
        .from(assets)
        .where(and(eq(assets.id, input.assetId), eq(assets.ownerUserId, input.ownerUserId)))
        .limit(1);
      return asset ? assetSchema.parse(asset) : null;
    },
    async getVisibleAsset(input) {
      const [asset] = await getDb()
        .select()
        .from(visibleAssets)
        .where(
          and(
            eq(visibleAssets.id, input.assetId),
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "a",
              recordKind: "asset",
            }),
          ),
        )
        .limit(1);
      return asset ? assetSchema.parse(asset) : null;
    },
    async updateAsset(input) {
      // Validate the patched fields so constraints hold for direct store callers.
      // A defaults-free schema is essential here: a partial of the base schema
      // would inject default values for absent keys and wipe those columns on
      // update (scope, status, householdId, …).
      const patch = assetUpdateSchema.parse(input.patch);
      const [asset] = await getDb()
        .update(assets)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(assets.id, input.assetId), eq(assets.ownerUserId, input.ownerUserId)))
        .returning();
      if (!asset) {
        throw new Error("Asset not found.");
      }
      return assetSchema.parse(asset);
    },
    async listVisibleAssetsForCaller(input) {
      // Scope filtering happens here, pre-retrieval: the predicate keeps private
      // assets to their owner and admits household / selected-shared ones only for
      // members who may see them, so nothing out of scope ever reaches a surface.
      const query = getDb()
        .select()
        .from(visibleAssets)
        .where(
          and(
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "a",
              recordKind: "asset",
            }),
            ...(input.kinds && input.kinds.length > 0
              ? [inArray(visibleAssets.kind, input.kinds)]
              : []),
            ...(input.statuses && input.statuses.length > 0
              ? [inArray(visibleAssets.status, input.statuses)]
              : []),
            ...(input.scopes && input.scopes.length > 0
              ? [inArray(visibleAssets.scope, input.scopes)]
              : []),
          ),
        )
        .orderBy(...nameOrder);

      const rows = await (input.limit === undefined ? query : query.limit(input.limit));
      return rows.map((row) => assetSchema.parse(row));
    },
    async createAssetAuditEvent(values) {
      const [event] = await getDb()
        .insert(assetAuditEvents)
        .values(createAssetAuditEventSchema.parse(values))
        .returning();
      if (!event) {
        throw new Error("Failed to record asset audit event.");
      }
      return assetAuditEventSchema.parse(event);
    },
    async listAssetAuditEvents(input) {
      const rows = await getDb()
        .select()
        .from(assetAuditEvents)
        .where(
          and(
            eq(assetAuditEvents.ownerUserId, input.ownerUserId),
            eq(assetAuditEvents.assetId, input.assetId),
          ),
        )
        .orderBy(asc(assetAuditEvents.createdAt));
      return rows.map((row) => assetAuditEventSchema.parse(row));
    },
  };
}

/**
 * Asset lifecycle store: the CRUD/audit/visibility store plus the household store
 * for scope membership and shares. Mirrors the General Action lifecycle-store
 * composition (ADR 0153).
 */
export function createDrizzleAssetLifecycleStore(): AssetLifecycleStore {
  return {
    ...createDrizzleHouseholdStore(),
    ...createDrizzleAssetStore(),
  };
}
