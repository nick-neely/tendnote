import { randomUUID } from "node:crypto";
import { createInMemoryContextFactStore } from "../context-facts/in-memory-store";
import type {
  ContextFactImport,
  CreateContextFactImportInput,
  InMemoryContextFactImportStore,
} from "./types";

export function createInMemoryContextFactImportStore(): InMemoryContextFactImportStore {
  const base = createInMemoryContextFactStore();
  const imports = new Map<string, ContextFactImport>();

  return {
    ...base,
    async createContextFactImport(input: CreateContextFactImportInput) {
      const now = new Date();
      const record: ContextFactImport = {
        ...input,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      imports.set(record.id, record);
      return record;
    },
    async getContextFactImport(importId: string) {
      return imports.get(importId) ?? null;
    },
  };
}
