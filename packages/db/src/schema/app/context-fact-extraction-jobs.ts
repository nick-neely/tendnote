import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { contextFactExtractionJobStatus } from "./enums";

/** Postgres-owned ambient Context Fact extraction jobs (#349). The raw current message is
 * bounded and retained only as queue input; the processor writes bounded evidence, never
 * copies this payload into Context Facts. */
export const contextFactExtractionJobs = pgTable(
  "context_fact_extraction_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    message: text("message"),
    claimToken: text("claim_token"),
    status: contextFactExtractionJobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull(),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("context_fact_extraction_jobs_idempotency_key_idx").on(table.idempotencyKey),
    index("context_fact_extraction_jobs_owner_status_idx").on(table.ownerUserId, table.status),
    index("context_fact_extraction_jobs_status_run_after_idx").on(table.status, table.runAfter),
    // Keep queue payload bounded at the database boundary as well as in the domain adapter.
    // This check deliberately does not persist a second copy in any Context Fact table.
    check(
      "context_fact_extraction_jobs_message_length_check",
      sql`${table.message} IS NULL OR char_length(btrim(${table.message})) between 1 and 2000`,
    ),
  ],
);
