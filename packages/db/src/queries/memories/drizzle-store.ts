import { createMemorySchema } from "@tendnote/domain";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { memories } from "../../schema";
import { createDrizzleSourceRecordStore } from "../source-records/drizzle-store";
import type { MemoryCaptureStore } from "./types";

export function createDrizzleMemoryStore(): MemoryCaptureStore {
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
  };
}
