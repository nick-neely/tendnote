import {
  assetAuditEventSchema,
  assetSchema,
  assetUpdateSchema,
  createAssetAuditEventSchema,
  createAssetSchema,
  DURABLE_ASSET_STATUSES,
} from "@tendnote/domain";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import {
  assetAuditEvents,
  assetEvidence,
  assetMemories,
  assets,
  householdRecordShares,
  relationshipContextEmbeddingJobs,
  relationshipContextEmbeddings,
} from "../../schema";
import { provenVisibleRecord } from "../households/authorization";
import { createDrizzleHouseholdStore } from "../households/drizzle-store";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import { createDrizzleSourceRecordStore } from "../source-records/drizzle-store";
import { createDrizzleGeneralActionAssetLinkStore } from "./drizzle-action-link-store";
import { createDrizzleAssetEvidenceStore } from "./drizzle-evidence-store";
import { createDrizzleAssetReviewStore } from "./drizzle-review-store";
import type { AssetReviewLifecycleStore } from "./review-types";
import type { AssetLifecycleStore, AssetStore } from "./types";

// Aliased so the scope-visibility predicate can reference the row as `a`, matching
// the alias the shared `visibleHouseholdRecordSql` builder expects.
const visibleAssets = alias(assets, "a");

// Review-gated rows (suggested proposals and dismissed husks) are owner-only:
// every scope-visible read filters to durable statuses, so a proposal never
// reaches any surface — not a member's, not even the owner's own Assets ledger —
// until it is accepted (#198; mirrors the General Action durable-status rule).
const durableVisibleStatus = inArray(visibleAssets.status, [...DURABLE_ASSET_STATUSES]);

// Shared ordering contract: case-insensitive name ascending — a browsable ledger,
// not a feed — with most-recently-created breaking ties. The in-memory store's
// `byNameThenCreated` mirrors this expression; keep the two in step.
const nameOrder = [sql`lower(${visibleAssets.name}) asc`, desc(visibleAssets.createdAt)];

/**
 * Postgres compares a `uuid` column against a uuid, not against text: hand it
 * `"Kitchen refrigerator"` and it raises `22P02` instead of returning no rows. Callers
 * do arrive with an id they did not read off a record — the assistant guesses one, a URL
 * is hand-edited — and a guess must be *denied*, not crashed on.
 *
 * The adapter is the only layer that knows the column's type, so it is the layer that
 * turns a malformed id into the same deterministic denial as an id that names nothing
 * (ADR 0153): an asset the caller cannot see, one that does not exist, and one whose id
 * could never exist are indistinguishable. The in-memory twin already behaves this way —
 * a string simply matches no row — so this is also what keeps the two stores honest.
 *
 * The blast radius of *not* doing this is not just a 500: a driver error escaping a seam
 * carries the failed SQL and its bound parameters in its message, and any surface that
 * echoes an error message then leaks the schema — and the caller's own values — with it.
 */
const PERSISTED_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPersistedAssetId(assetId: string): boolean {
  return PERSISTED_ID_PATTERN.test(assetId);
}

/**
 * Drizzle-backed Asset CRUD + internal-audit store. Owner scoping is enforced in
 * every owner-keyed predicate so a caller can only read or mutate their own
 * assets; the `Visible` reads apply the shared Phase 4 scope predicate so
 * household and selected-shared assets surface to exactly the members who may see
 * them (AGENTS.md owner-scoped seams; ADR 0153).
 */
/**
 * The owner-keyed read of one Asset. Shared so every seam that needs an owner's asset —
 * the lifecycle store here, the semantic embedding store — issues the same query rather
 * than re-deriving the predicate (mirrors `selectOwnedGeneralAction`).
 */
export async function selectOwnedAsset(input: { ownerUserId: string; assetId: string }) {
  if (!isPersistedAssetId(input.assetId)) {
    return null;
  }

  const [asset] = await getDb()
    .select()
    .from(assets)
    .where(and(eq(assets.id, input.assetId), eq(assets.ownerUserId, input.ownerUserId)))
    .limit(1);

  return asset ? assetSchema.parse(asset) : null;
}

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
    getAsset: selectOwnedAsset,
    async getVisibleAsset(input) {
      if (!isPersistedAssetId(input.assetId)) {
        return null;
      }

      const [asset] = await getDb()
        .select()
        .from(visibleAssets)
        .where(
          and(
            eq(visibleAssets.id, input.assetId),
            durableVisibleStatus,
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "a",
              recordKind: "asset",
            }),
          ),
        )
        .limit(1);

      // As with General Actions: the predicate narrows, the proof authorizes, and
      // a refusal is indistinguishable from an asset that is not there.
      const proven = await provenVisibleRecord({
        callerUserId: input.callerUserId,
        row: asset,
        facts: (row) => ({
          kind: "asset",
          id: row.id,
          ownerUserId: row.ownerUserId,
          scope: row.scope,
          householdId: row.householdId,
        }),
      });

      return proven ? assetSchema.parse(proven) : null;
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
    async deleteAsset(input) {
      return getDb().transaction(async (tx) => {
        const [owned] = await tx
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.id, input.assetId), eq(assets.ownerUserId, input.ownerUserId)))
          .limit(1);
        if (!owned) return false;

        const memoryRows = await tx
          .select({ id: assetMemories.id })
          .from(assetMemories)
          .where(eq(assetMemories.assetId, input.assetId));
        const memoryIds = memoryRows.map((row) => row.id);
        const evidenceRows = await tx
          .select({ id: assetEvidence.id })
          .from(assetEvidence)
          .where(eq(assetEvidence.assetId, input.assetId));
        const evidenceIds = evidenceRows.map((row) => row.id);
        const semanticRecord = or(
          and(
            eq(relationshipContextEmbeddings.recordKind, "asset"),
            eq(relationshipContextEmbeddings.recordId, input.assetId),
          ),
          ...(memoryIds.length
            ? [
                and(
                  eq(relationshipContextEmbeddings.recordKind, "asset_memory"),
                  inArray(relationshipContextEmbeddings.recordId, memoryIds),
                ),
              ]
            : []),
        );
        const semanticJob = or(
          and(
            eq(relationshipContextEmbeddingJobs.recordKind, "asset"),
            eq(relationshipContextEmbeddingJobs.recordId, input.assetId),
          ),
          ...(memoryIds.length
            ? [
                and(
                  eq(relationshipContextEmbeddingJobs.recordKind, "asset_memory"),
                  inArray(relationshipContextEmbeddingJobs.recordId, memoryIds),
                ),
              ]
            : []),
        );
        await tx.delete(relationshipContextEmbeddings).where(semanticRecord);
        await tx.delete(relationshipContextEmbeddingJobs).where(semanticJob);
        await tx
          .delete(householdRecordShares)
          .where(
            or(
              and(
                eq(householdRecordShares.recordKind, "asset"),
                eq(householdRecordShares.recordId, input.assetId),
              ),
              ...(memoryIds.length
                ? [
                    and(
                      eq(householdRecordShares.recordKind, "asset_memory"),
                      inArray(householdRecordShares.recordId, memoryIds),
                    ),
                  ]
                : []),
              ...(evidenceIds.length
                ? [
                    and(
                      eq(householdRecordShares.recordKind, "asset_evidence"),
                      inArray(householdRecordShares.recordId, evidenceIds),
                    ),
                  ]
                : []),
            ),
          );
        await tx
          .delete(assets)
          .where(and(eq(assets.id, input.assetId), eq(assets.ownerUserId, input.ownerUserId)));
        return true;
      });
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
            durableVisibleStatus,
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

      const offsetQuery = input.offset === undefined ? query : query.offset(input.offset);
      const rows = await (input.limit === undefined ? offsetQuery : offsetQuery.limit(input.limit));
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

/**
 * Asset review lifecycle store (#198): the lifecycle store plus the Asset
 * Memory / Asset Review Group store, the Asset Evidence store (#200), the
 * action-link store (#199), and source-record grounding lookups — everything
 * `createAssetReview` composes over.
 */
export function createDrizzleAssetReviewLifecycleStore(): AssetReviewLifecycleStore {
  return {
    ...createDrizzleSourceRecordStore(),
    ...createDrizzleAssetLifecycleStore(),
    ...createDrizzleAssetReviewStore(),
    ...createDrizzleAssetEvidenceStore(),
    ...createDrizzleGeneralActionAssetLinkStore(),
  };
}
