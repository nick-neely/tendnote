import { assetSnapshotSchema, createAssetSnapshotSchema } from "@tendnote/domain";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { assetSnapshots } from "../../schema";
import type { AssetSnapshotStore } from "./types";

export function createDrizzleAssetSnapshotStore(): AssetSnapshotStore {
  return {
    async getAssetSnapshot(input) {
      const [snapshot] = await getDb()
        .select()
        .from(assetSnapshots)
        .where(
          and(
            eq(assetSnapshots.ownerUserId, input.ownerUserId),
            eq(assetSnapshots.assetId, input.assetId),
          ),
        )
        .limit(1);

      return snapshot ? assetSnapshotSchema.parse(snapshot) : null;
    },
    async upsertAssetSnapshot(input) {
      const parsed = createAssetSnapshotSchema.parse(input);
      const [snapshot] = await getDb()
        .insert(assetSnapshots)
        .values(parsed)
        // One current row per (caller, asset): a rebuild replaces, never appends.
        .onConflictDoUpdate({
          target: [assetSnapshots.ownerUserId, assetSnapshots.assetId],
          set: {
            summary: parsed.summary,
            supportingReferences: parsed.supportingReferences,
            generatorVersion: parsed.generatorVersion,
            inputFingerprint: parsed.inputFingerprint,
            generatedAt: parsed.generatedAt,
            failureReason: parsed.failureReason ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();

      return assetSnapshotSchema.parse(snapshot);
    },
  };
}
