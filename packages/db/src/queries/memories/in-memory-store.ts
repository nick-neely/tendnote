import { randomUUID } from "node:crypto";
import { createMemorySchema, type Memory, memorySchema } from "@tendnote/domain";
import { createInMemorySourceRecordStore } from "../source-records/in-memory-store";
import type { InMemoryMemoryStore } from "./types";

export function createInMemoryMemoryStore(): InMemoryMemoryStore {
  const base = createInMemorySourceRecordStore();
  const memories = new Map<string, Memory>();

  return {
    ...base,
    async createMemory(values) {
      // Re-validate so source-record provenance cannot be bypassed by direct
      // store callers, not only by the capture wrapper (ADR 0022).
      const parsed = createMemorySchema.parse(values);
      const now = new Date();
      const memory: Memory = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      memories.set(memory.id, memory);

      return memory;
    },
    async listApprovedMemoriesForPerson(input) {
      return [...memories.values()]
        .filter(
          (memory) =>
            memory.ownerUserId === input.ownerUserId &&
            memory.personId === input.personId &&
            memory.status === "approved",
        )
        .sort(
          (a, b) => b.importance - a.importance || b.createdAt.getTime() - a.createdAt.getTime(),
        );
    },
    async listMemoriesForSourceRecord(input) {
      return [...memories.values()]
        .filter((memory) => memory.sourceRecordId === input.sourceRecordId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async getMemory(input) {
      const memory = memories.get(input.memoryId);

      if (!memory || memory.ownerUserId !== input.ownerUserId) {
        return null;
      }

      return memory;
    },
    async updateMemory(input) {
      const memory = memories.get(input.memoryId);

      if (!memory || memory.ownerUserId !== input.ownerUserId) {
        throw new Error("Memory not found.");
      }

      // Re-validate the merged record so provenance and field constraints hold
      // for direct store callers, not only the review wrapper (ADR 0022).
      const updated = memorySchema.parse({
        ...memory,
        ...input.patch,
        updatedAt: new Date(),
      });

      memories.set(updated.id, updated);

      return updated;
    },
    async listSuggestedMemoriesForOwner(input) {
      return [...memories.values()]
        .filter(
          (memory) =>
            memory.ownerUserId === input.ownerUserId &&
            memory.status === "suggested" &&
            (input.personId === undefined || memory.personId === input.personId),
        )
        .sort(
          (a, b) => b.importance - a.importance || b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .slice(0, input.limit ?? 20);
    },
  };
}
