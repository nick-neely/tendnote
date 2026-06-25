import { createMemorySchema, memorySchema } from "@tendnote/domain";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { memories } from "../../schema";
import { createDrizzleSourceRecordStore } from "../source-records/drizzle-store";
import type { MemoryReviewStore } from "./types";

export function createDrizzleMemoryStore(): MemoryReviewStore {
  const base = createDrizzleSourceRecordStore();

  return {
    ...base,
    async createMemory(values) {
      // Re-validate so source-record provenance cannot be bypassed by direct
      // store callers, not only by the capture wrapper (ADR 0022).
      const [memory] = await getDb()
        .insert(memories)
        .values(createMemorySchema.parse(values))
        .returning();

      if (!memory) {
        throw new Error("Failed to create memory.");
      }

      return memory;
    },
    async listApprovedMemoriesForPerson(input) {
      return getDb()
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.ownerUserId, input.ownerUserId),
            eq(memories.personId, input.personId),
            eq(memories.status, "approved"),
          ),
        )
        .orderBy(desc(memories.importance), desc(memories.createdAt));
    },
    async listMemoriesForSourceRecord(input) {
      return getDb()
        .select()
        .from(memories)
        .where(eq(memories.sourceRecordId, input.sourceRecordId))
        .orderBy(memories.createdAt);
    },
    async getMemory(input) {
      const [memory] = await getDb()
        .select()
        .from(memories)
        .where(and(eq(memories.id, input.memoryId), eq(memories.ownerUserId, input.ownerUserId)))
        .limit(1);

      return memory ?? null;
    },
    async updateMemory(input) {
      // Validate the patched fields so constraints (content length, enums, status)
      // hold for direct store callers, matching the in-memory store (ADR 0022).
      const patch = memorySchema.partial().parse(input.patch);
      const [memory] = await getDb()
        .update(memories)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(memories.id, input.memoryId), eq(memories.ownerUserId, input.ownerUserId)))
        .returning();

      if (!memory) {
        throw new Error("Memory not found.");
      }

      return memory;
    },
    async listSuggestedMemoriesForOwner(input) {
      return getDb()
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.ownerUserId, input.ownerUserId),
            eq(memories.status, "suggested"),
            ...(input.personId ? [eq(memories.personId, input.personId)] : []),
          ),
        )
        .orderBy(desc(memories.importance), desc(memories.createdAt))
        .limit(input.limit ?? 20);
    },
  };
}
