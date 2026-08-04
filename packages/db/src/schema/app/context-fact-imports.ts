import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { contextFactImportProvider, contextFactImportSource } from "./enums";

/**
 * One deliberate Self Context import session: the owner asked another assistant what
 * it remembers about them and pasted the answer back.
 *
 * This row is the real source reference every imported Context Fact's provenance
 * points at, which is what the Phase 7.5 contract requires of imported facts. It
 * deliberately holds no copy of the paste — only its shape — so the raw memory
 * export is never retained. The reviewable statements live on the Context Facts
 * themselves, where the owner can edit or delete each one independently.
 */
export const contextFactImports = pgTable(
  "context_fact_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: contextFactImportProvider("provider").notNull(),
    source: contextFactImportSource("source").notNull(),
    /** The paste's length, kept as provenance shape. The paste itself is not stored. */
    textLength: integer("text_length").notNull(),
    /** Candidates that survived domain validation and were offered for review. */
    candidateCount: integer("candidate_count").notNull(),
    ...timestamps,
  },
  (table) => [
    index("context_fact_imports_owner_created_idx").on(table.ownerUserId, table.createdAt),
    check("context_fact_imports_text_length_check", sql`${table.textLength} between 1 and 16000`),
    check(
      "context_fact_imports_candidate_count_check",
      sql`${table.candidateCount} between 0 and 24`,
    ),
  ],
);
