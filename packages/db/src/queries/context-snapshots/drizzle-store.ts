import { createContextSnapshotSchema } from "@tendnote/domain";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { personContextSnapshots } from "../../schema";
import type { ContextSnapshotStore } from "./types";

/**
 * Drizzle-backed snapshot cache. The upsert targets the owner/person unique
 * index so writes keep exactly one current row per owner/person (ADR 0009).
 * Snapshot rebuilds never touch the audit log (PRD #11).
 */
export function createDrizzleContextSnapshotStore(): ContextSnapshotStore {
  return {
    async getContextSnapshot(input) {
      const [snapshot] = await getDb()
        .select()
        .from(personContextSnapshots)
        .where(
          and(
            eq(personContextSnapshots.ownerUserId, input.ownerUserId),
            eq(personContextSnapshots.personId, input.personId),
          ),
        )
        .limit(1);

      return snapshot ?? null;
    },
    async upsertContextSnapshot(values) {
      const parsed = createContextSnapshotSchema.parse(values);
      const now = new Date();
      const [snapshot] = await getDb()
        .insert(personContextSnapshots)
        .values(parsed)
        .onConflictDoUpdate({
          target: [personContextSnapshots.ownerUserId, personContextSnapshots.personId],
          set: {
            summary: parsed.summary,
            supportingReferences: parsed.supportingReferences,
            generatorVersion: parsed.generatorVersion,
            inputFingerprint: parsed.inputFingerprint,
            generatedAt: parsed.generatedAt,
            failureReason: parsed.failureReason ?? null,
            updatedAt: now,
          },
        })
        .returning();

      if (!snapshot) {
        throw new Error("Failed to upsert context snapshot.");
      }

      return snapshot;
    },
  };
}
