import { eq } from "drizzle-orm";
import { getDb } from "../../client";
import { contextFactImports } from "../../schema";
import { createDrizzleContextFactStore } from "../context-facts/drizzle-store";
import type {
  ContextFactImport,
  ContextFactImportStore,
  CreateContextFactImportInput,
} from "./types";

function fromRow(row: typeof contextFactImports.$inferSelect): ContextFactImport {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    provider: row.provider,
    source: row.source,
    textLength: row.textLength,
    candidateCount: row.candidateCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleContextFactImportStore(): ContextFactImportStore {
  const base = createDrizzleContextFactStore();

  return {
    ...base,
    async createContextFactImport(input: CreateContextFactImportInput) {
      const [row] = await getDb().insert(contextFactImports).values(input).returning();
      if (!row) throw new Error("Failed to record the Self Context import.");
      return fromRow(row);
    },
    async getContextFactImport(importId) {
      const [row] = await getDb()
        .select()
        .from(contextFactImports)
        .where(eq(contextFactImports.id, importId))
        .limit(1);
      return row ? fromRow(row) : null;
    },
  };
}
