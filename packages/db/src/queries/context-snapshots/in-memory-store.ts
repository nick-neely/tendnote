import { randomUUID } from "node:crypto";
import { type ContextSnapshot, createContextSnapshotSchema } from "@tendnote/domain";
import type { InMemoryContextSnapshotStore } from "./types";

/**
 * In-memory snapshot cache for tests and the composed person-context store. Keyed
 * by owner/person so an upsert can only ever replace the single current row,
 * mirroring the unique index on the table (ADR 0009).
 */
export function createInMemoryContextSnapshotStore(): InMemoryContextSnapshotStore {
  const snapshots = new Map<string, ContextSnapshot>();
  const keyOf = (ownerUserId: string, personId: string) => `${ownerUserId}:${personId}`;

  return {
    async getContextSnapshot(input) {
      return snapshots.get(keyOf(input.ownerUserId, input.personId)) ?? null;
    },
    async upsertContextSnapshot(values) {
      const parsed = createContextSnapshotSchema.parse(values);
      const key = keyOf(parsed.ownerUserId, parsed.personId);
      const existing = snapshots.get(key);
      const now = new Date();
      const snapshot: ContextSnapshot = {
        ...parsed,
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      snapshots.set(key, snapshot);

      return snapshot;
    },
    async listContextSnapshots(input) {
      return [...snapshots.values()].filter(
        (snapshot) => snapshot.ownerUserId === input.ownerUserId,
      );
    },
  };
}
