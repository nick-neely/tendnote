import { randomUUID } from "node:crypto";
import { type AssetSnapshot, createAssetSnapshotSchema } from "@tendnote/domain";
import type { InMemoryAssetSnapshotStore } from "./types";

/** One current row per (caller, asset) — a cache, not a history. */
export function createInMemoryAssetSnapshotStore(): InMemoryAssetSnapshotStore {
  const snapshots = new Map<string, AssetSnapshot>();
  const key = (ownerUserId: string, assetId: string) => `${ownerUserId}:${assetId}`;

  return {
    async getAssetSnapshot(input) {
      return snapshots.get(key(input.ownerUserId, input.assetId)) ?? null;
    },
    async upsertAssetSnapshot(input) {
      const parsed = createAssetSnapshotSchema.parse(input);
      const existing = snapshots.get(key(parsed.ownerUserId, parsed.assetId));
      const now = new Date();
      const snapshot: AssetSnapshot = {
        ...parsed,
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      snapshots.set(key(parsed.ownerUserId, parsed.assetId), snapshot);

      return snapshot;
    },
    async listAssetSnapshots(input) {
      return [...snapshots.values()].filter(
        (snapshot) => snapshot.ownerUserId === input.ownerUserId,
      );
    },
  };
}
