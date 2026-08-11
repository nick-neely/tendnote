import { randomUUID } from "node:crypto";
import {
  type Asset,
  type AssetAuditEvent,
  type AssetKind,
  type AssetStatus,
  assetAuditEventSchema,
  assetSchema,
  canViewScopedRecord,
  createAssetAuditEventSchema,
  createAssetSchema,
  isDurableAssetStatus,
  type PrivacyScope,
  scopedRecordVisibility,
} from "@tendnote/domain";
import { createInMemoryHouseholdStore } from "../households/in-memory-store";
import type { HouseholdStore } from "../households/types";
import type { AssetStore } from "./types";

/**
 * Minimal Asset CRUD + audit store over a few maps, bundling a household store so
 * scope reads and share writes stay consistent across the composed seam — the
 * exact composition the General Action in-memory store uses (ADR 0153). Backs the
 * lifecycle tests and the store contract so the drizzle store cannot drift.
 *
 * Accepts an existing household store so the composed review store (#198) shares
 * the same membership/share state; defaults to its own for standalone use.
 */
export function createInMemoryAssetStore(
  householdStore: HouseholdStore = createInMemoryHouseholdStore(),
): AssetStore & HouseholdStore {
  const assets = new Map<string, Asset>();
  const auditEvents: AssetAuditEvent[] = [];

  /**
   * Whether `callerUserId` may see `asset` under the Phase 4 scope rules: private
   * is owner-only; household is any active member of the asset's household; shared
   * is the owner plus explicitly selected members. Fail closed — a non-private
   * asset with no household is visible to no one (ADR 0153).
   */
  async function canCallerView(input: { callerUserId: string; asset: Asset }) {
    // Review-gated rows are owner-only: a Suggested Asset (and a dismissed
    // proposal husk) is never scope-visible, even at household scope, until it
    // is accepted — mirroring the General Action durable-status rule (#198).
    if (!isDurableAssetStatus(input.asset.status)) {
      return false;
    }

    const activeMemberships = input.asset.householdId
      ? await householdStore.listHouseholdMemberships({
          householdId: input.asset.householdId,
          status: "active",
        })
      : [];
    const shares =
      input.asset.scope === "shared" && input.asset.householdId
        ? await householdStore.listHouseholdRecordShares({
            householdId: input.asset.householdId,
            recordKind: "asset",
            recordId: input.asset.id,
          })
        : [];

    return canViewScopedRecord({
      callerUserId: input.callerUserId,
      record: scopedRecordVisibility({
        ownerUserId: input.asset.ownerUserId,
        scope: input.asset.scope,
        householdId: input.asset.householdId,
        shares,
      }),
      activeMemberships,
    });
  }

  return {
    async createAsset(values) {
      const parsed = createAssetSchema.parse(values);
      const now = new Date();
      const asset: Asset = { ...parsed, id: randomUUID(), createdAt: now, updatedAt: now };
      assets.set(asset.id, asset);
      return asset;
    },
    async getAsset(input) {
      const asset = assets.get(input.assetId);
      if (!asset || asset.ownerUserId !== input.ownerUserId) {
        return null;
      }
      return asset;
    },
    async getVisibleAsset(input) {
      const asset = assets.get(input.assetId);
      if (!asset || !(await canCallerView({ callerUserId: input.callerUserId, asset }))) {
        return null;
      }
      return asset;
    },
    async updateAsset(input) {
      const asset = assets.get(input.assetId);
      if (!asset || asset.ownerUserId !== input.ownerUserId) {
        throw new Error("Asset not found.");
      }
      // Re-validate the merged record so field constraints hold for direct store
      // callers too, matching the drizzle store. Every write bumps the fence —
      // it is the store's, never a caller's, so a patch cannot rewind it (#386).
      const updated = assetSchema.parse({
        ...asset,
        ...input.patch,
        revision: asset.revision + 1,
        updatedAt: new Date(),
      });
      assets.set(updated.id, updated);
      return updated;
    },
    async deleteAsset(input) {
      const asset = assets.get(input.assetId);
      if (!asset || asset.ownerUserId !== input.ownerUserId) {
        return false;
      }
      assets.delete(input.assetId);
      for (let index = auditEvents.length - 1; index >= 0; index -= 1) {
        if (auditEvents[index]?.assetId === input.assetId) {
          auditEvents.splice(index, 1);
        }
      }
      return true;
    },
    async listVisibleAssetsForCaller(input) {
      const visible: Asset[] = [];
      for (const asset of assets.values()) {
        if (
          matchesAssetFilters(asset, input) &&
          (await canCallerView({ callerUserId: input.callerUserId, asset }))
        ) {
          visible.push(asset);
        }
      }
      visible.sort(byNameThenCreated);
      const offset = input.offset ?? 0;
      return input.limit === undefined
        ? visible.slice(offset)
        : visible.slice(offset, offset + input.limit);
    },
    async createAssetAuditEvent(values) {
      const parsed = createAssetAuditEventSchema.parse(values);
      const event: AssetAuditEvent = assetAuditEventSchema.parse({
        ...parsed,
        id: randomUUID(),
        createdAt: new Date(),
      });
      auditEvents.push(event);
      return event;
    },
    async listAssetAuditEvents(input) {
      return auditEvents
        .filter(
          (event) => event.ownerUserId === input.ownerUserId && event.assetId === input.assetId,
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    ...householdStore,
  };
}

/** Whether an asset matches the surface's optional kind/status/scope narrowing. */
function matchesAssetFilters(
  asset: Asset,
  filters: { kinds?: AssetKind[]; statuses?: AssetStatus[]; scopes?: PrivacyScope[] },
): boolean {
  return (
    (filters.kinds === undefined || filters.kinds.includes(asset.kind)) &&
    (filters.statuses === undefined || filters.statuses.includes(asset.status)) &&
    (filters.scopes === undefined || filters.scopes.includes(asset.scope))
  );
}

/**
 * The shared listing-order contract: case-insensitive name ascending — a
 * browsable ledger, not a feed — with most-recently-created as a stable tiebreak.
 * The drizzle store expresses the same rule as `lower(name) asc, created_at desc`.
 */
function byNameThenCreated(a: Asset, b: Asset): number {
  const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  if (byName !== 0) {
    return byName;
  }
  return b.createdAt.getTime() - a.createdAt.getTime();
}
