import {
  type AssetEvidence,
  type AssetEvidenceMoney,
  assetEvidenceSchema,
  assetEvidenceUpdateSchema,
  createAssetEvidenceSchema,
  DURABLE_ASSET_STATUSES,
} from "@tendnote/domain";
import { and, asc, eq, exists, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import { assetEvidence, assetEvidenceFiles, assets } from "../../schema";
import { visibleHouseholdRecordSql } from "../households/visibility-sql";
import type { AssetEvidenceStore } from "./evidence-types";

// Aliased so the scope-visibility predicate can reference the row as `ae`,
// matching the alias the shared `visibleHouseholdRecordSql` builder expects.
const visibleEvidence = alias(assetEvidence, "ae");

// Shared ordering contract: oldest first, id tiebreak — a stable ledger. The
// in-memory store's `byCreatedThenId` mirrors this; keep the two in step.
const evidenceOrder = [asc(assetEvidence.createdAt), asc(assetEvidence.id)];

/** Maps a raw row (money_json → money) into the domain shape before parsing. */
function parseEvidenceRow(row: typeof assetEvidence.$inferSelect): AssetEvidence {
  const { moneyJson, ...rest } = row;
  return assetEvidenceSchema.parse({ ...rest, money: moneyJson });
}

/** Maps a domain evidence write (money → money_json) into column values. */
function toEvidenceColumns<T extends { money?: AssetEvidenceMoney | null }>(
  values: T,
): Omit<T, "money"> & { moneyJson?: AssetEvidenceMoney | null } {
  const { money, ...rest } = values;
  return { ...rest, ...(money !== undefined ? { moneyJson: money } : {}) };
}

/**
 * The durable-anchor guard for visible evidence reads (#200): evidence surfaces
 * only under a real (active/archived) Asset, so a capture riding a still-pending
 * Asset Review Group stays its owner's until review resolves — the same
 * durable-status rule every scope-visible asset read applies.
 */
function durableAnchorExists() {
  const db = getDb();
  return exists(
    db
      .select({ one: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.id, visibleEvidence.assetId),
          inArray(assets.status, [...DURABLE_ASSET_STATUSES]),
        ),
      ),
  );
}

/**
 * Drizzle-backed Asset Evidence store (#200). Every method is owner-keyed except
 * the `Visible` reads, which apply the shared per-record scope predicate under a
 * durable anchor. Bytes live in `asset_evidence_files`, written atomically with
 * the metadata row and cascade-deleted with it; metadata reads never join them.
 */
export function createDrizzleAssetEvidenceStore(): AssetEvidenceStore {
  return {
    async createAssetEvidence(input) {
      const parsed = createAssetEvidenceSchema.parse(input.values);
      if ((parsed.fileName !== null) !== (input.fileBytes !== undefined)) {
        throw new Error("Evidence file metadata and bytes must travel together.");
      }
      const fileBytes = input.fileBytes;
      // Metadata and bytes land together or not at all — no torn uploads.
      const row = await getDb().transaction(async (tx) => {
        const [evidenceRow] = await tx
          .insert(assetEvidence)
          .values(toEvidenceColumns(parsed))
          .returning();
        if (!evidenceRow) {
          throw new Error("Failed to create asset evidence.");
        }
        if (fileBytes) {
          await tx.insert(assetEvidenceFiles).values({
            evidenceId: evidenceRow.id,
            ownerUserId: evidenceRow.ownerUserId,
            bytes: fileBytes,
          });
        }
        return evidenceRow;
      });
      return parseEvidenceRow(row);
    },
    async getAssetEvidence(input) {
      const [row] = await getDb()
        .select()
        .from(assetEvidence)
        .where(
          and(
            eq(assetEvidence.id, input.evidenceId),
            eq(assetEvidence.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);
      return row ? parseEvidenceRow(row) : null;
    },
    async getVisibleAssetEvidence(input) {
      const [row] = await getDb()
        .select()
        .from(visibleEvidence)
        .where(
          and(
            eq(visibleEvidence.id, input.evidenceId),
            durableAnchorExists(),
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "ae",
              recordKind: "asset_evidence",
            }),
          ),
        )
        .limit(1);
      return row ? parseEvidenceRow(row) : null;
    },
    async updateAssetEvidence(input) {
      // Defaults-free patch parse: an absent key stays absent, so a re-anchor
      // patch never wipes content or metadata columns.
      const patch = assetEvidenceUpdateSchema.parse(input.patch);
      const [row] = await getDb()
        .update(assetEvidence)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(assetEvidence.id, input.evidenceId),
            eq(assetEvidence.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();
      if (!row) {
        throw new Error("Asset evidence not found.");
      }
      return parseEvidenceRow(row);
    },
    async deleteAssetEvidence(input) {
      // Bytes cascade with the row (asset_evidence_files.evidence_id).
      const deleted = await getDb()
        .delete(assetEvidence)
        .where(
          and(
            eq(assetEvidence.id, input.evidenceId),
            eq(assetEvidence.ownerUserId, input.ownerUserId),
          ),
        )
        .returning({ id: assetEvidence.id });
      if (deleted.length === 0) {
        throw new Error("Asset evidence not found.");
      }
    },
    async listAssetEvidenceForOwner(input) {
      const rows = await getDb()
        .select()
        .from(assetEvidence)
        .where(
          and(
            eq(assetEvidence.ownerUserId, input.ownerUserId),
            ...(input.assetId !== undefined ? [eq(assetEvidence.assetId, input.assetId)] : []),
            ...(input.reviewGroupId !== undefined
              ? [eq(assetEvidence.reviewGroupId, input.reviewGroupId)]
              : []),
          ),
        )
        .orderBy(...evidenceOrder);
      return rows.map((row) => parseEvidenceRow(row));
    },
    async listVisibleAssetEvidenceForAsset(input) {
      // Per-record scope filtering, pre-retrieval: each piece of evidence is
      // filtered independently of its asset, so a household asset can hold a
      // private receipt its members never see (#196) — and only under a durable
      // anchor, so review-pending captures stay their owner's.
      const rows = await getDb()
        .select()
        .from(visibleEvidence)
        .where(
          and(
            eq(visibleEvidence.assetId, input.assetId),
            durableAnchorExists(),
            visibleHouseholdRecordSql({
              callerUserId: input.callerUserId,
              tableAlias: "ae",
              recordKind: "asset_evidence",
            }),
          ),
        )
        .orderBy(asc(visibleEvidence.createdAt), asc(visibleEvidence.id));
      return rows.map((row) => parseEvidenceRow(row));
    },
    async getAssetEvidenceFileBytes(input) {
      const [row] = await getDb()
        .select({ bytes: assetEvidenceFiles.bytes })
        .from(assetEvidenceFiles)
        .where(eq(assetEvidenceFiles.evidenceId, input.evidenceId))
        .limit(1);
      return row?.bytes ?? null;
    },
  };
}
