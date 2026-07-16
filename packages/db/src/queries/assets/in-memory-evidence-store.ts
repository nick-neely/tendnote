import { randomUUID } from "node:crypto";
import {
  type AssetEvidence,
  assetEvidenceSchema,
  assetEvidenceUpdateSchema,
  canViewScopedRecord,
  createAssetEvidenceSchema,
  isDurableAssetStatus,
  scopedRecordVisibility,
} from "@tendnote/domain";
import type { HouseholdStore } from "../households/types";
import type { AssetEvidenceStore } from "./evidence-types";
import type { AssetStore } from "./types";

/**
 * Minimal Asset Evidence store over maps (#200), mirroring the drizzle evidence
 * store's behavior so the review-evidence lifecycle tests are authoritative for
 * both. Bytes live in their own map keyed by evidence id — deleted with the row,
 * never touched by metadata reads. Visible reads apply per-record scope *and*
 * the durable-anchor guard: evidence under a still-suggested anchor stays its
 * owner's until review resolves.
 */
export function createInMemoryAssetEvidenceStore(deps: {
  getOwnedAsset: AssetStore["getAsset"];
  getVisibleAsset: AssetStore["getVisibleAsset"];
  householdStore: HouseholdStore;
}): AssetEvidenceStore {
  const evidence = new Map<string, AssetEvidence>();
  const fileBytes = new Map<string, Uint8Array>();

  /** Oldest first, id tiebreak — a stable ledger, both stores alike. */
  function byCreatedThenId(a: AssetEvidence, b: AssetEvidence): number {
    return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  }

  /** Whether the caller may see one evidence record: private = owner; household = members. */
  async function canCallerViewEvidence(input: { callerUserId: string; record: AssetEvidence }) {
    const activeMemberships = input.record.householdId
      ? await deps.householdStore.listHouseholdMemberships({
          householdId: input.record.householdId,
          status: "active",
        })
      : [];
    const shares = input.record.householdId
      ? await deps.householdStore.listHouseholdRecordShares({
          householdId: input.record.householdId,
          recordKind: "asset_evidence",
          recordId: input.record.id,
        })
      : [];
    return canViewScopedRecord({
      callerUserId: input.callerUserId,
      record: scopedRecordVisibility({
        ownerUserId: input.record.ownerUserId,
        scope: input.record.scope,
        householdId: input.record.householdId,
        shares,
      }),
      activeMemberships,
    });
  }

  /**
   * The durable-anchor guard for visible reads: evidence surfaces only under a
   * real (active/archived) Asset. The anchor is the evidence owner's own row in
   * the common case; after duplicate review links a group it may be a co-member's
   * durable asset, reachable through the caller's scope-visible read.
   */
  async function anchorIsDurable(record: AssetEvidence, callerUserId: string): Promise<boolean> {
    const owned = await deps.getOwnedAsset({
      ownerUserId: record.ownerUserId,
      assetId: record.assetId,
    });
    if (owned) {
      return isDurableAssetStatus(owned.status);
    }
    return (await deps.getVisibleAsset({ callerUserId, assetId: record.assetId })) !== null;
  }

  async function isVisibleTo(record: AssetEvidence, callerUserId: string): Promise<boolean> {
    return (
      (await anchorIsDurable(record, callerUserId)) &&
      (await canCallerViewEvidence({ callerUserId, record }))
    );
  }

  return {
    async createAssetEvidence(input) {
      const parsed = createAssetEvidenceSchema.parse(input.values);
      if ((parsed.fileName !== null) !== (input.fileBytes !== undefined)) {
        throw new Error("Evidence file metadata and bytes must travel together.");
      }
      const now = new Date();
      const record: AssetEvidence = { ...parsed, id: randomUUID(), createdAt: now, updatedAt: now };
      evidence.set(record.id, record);
      if (input.fileBytes) {
        fileBytes.set(record.id, input.fileBytes);
      }
      return record;
    },
    async getAssetEvidence(input) {
      const record = evidence.get(input.evidenceId);
      if (!record || record.ownerUserId !== input.ownerUserId) {
        return null;
      }
      return record;
    },
    async getVisibleAssetEvidence(input) {
      const record = evidence.get(input.evidenceId);
      if (!record || !(await isVisibleTo(record, input.callerUserId))) {
        return null;
      }
      return record;
    },
    async updateAssetEvidence(input) {
      const record = evidence.get(input.evidenceId);
      if (!record || record.ownerUserId !== input.ownerUserId) {
        throw new Error("Asset evidence not found.");
      }
      // Re-validate the merged record with the defaults-free patch schema so
      // constraints hold for direct store callers too, matching drizzle.
      const patch = assetEvidenceUpdateSchema.parse(input.patch);
      const updated = assetEvidenceSchema.parse({ ...record, ...patch, updatedAt: new Date() });
      evidence.set(updated.id, updated);
      return updated;
    },
    async deleteAssetEvidence(input) {
      const record = evidence.get(input.evidenceId);
      if (!record || record.ownerUserId !== input.ownerUserId) {
        throw new Error("Asset evidence not found.");
      }
      evidence.delete(input.evidenceId);
      fileBytes.delete(input.evidenceId);
    },
    async listAssetEvidenceForOwner(input) {
      return [...evidence.values()]
        .filter(
          (record) =>
            record.ownerUserId === input.ownerUserId &&
            (input.assetId === undefined || record.assetId === input.assetId) &&
            (input.reviewGroupId === undefined || record.reviewGroupId === input.reviewGroupId),
        )
        .sort(byCreatedThenId);
    },
    async listVisibleAssetEvidenceForAsset(input) {
      const visible: AssetEvidence[] = [];
      for (const record of evidence.values()) {
        if (record.assetId === input.assetId && (await isVisibleTo(record, input.callerUserId))) {
          visible.push(record);
        }
      }
      return visible.sort(byCreatedThenId);
    },
    async getAssetEvidenceFileBytes(input) {
      return fileBytes.get(input.evidenceId) ?? null;
    },
  };
}
