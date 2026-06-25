import { randomUUID } from "node:crypto";
import { createMemorySchema, type Memory } from "@tendnote/domain";
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
  };
}
