import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The outbound pause a restore holds (#623, ADR 0250): while its one row
 * exists, the recovery cron, every queue consumer, and every email send stand
 * down. It lives in the database so it travels with the data: the restore
 * writes it on the isolated branch before anything else touches it, and the
 * branch carries it through the swap until the operator resumes outbound.
 * Deployment-wide and content-free.
 */
export const outboundPause = pgTable(
  "outbound_pause",
  {
    singleton: boolean("singleton").primaryKey().default(true),
    pausedAt: timestamp("paused_at", { withTimezone: true }).notNull(),
  },
  (table) => [check("outbound_pause_singleton", sql`${table.singleton}`)],
);

/**
 * The email fences a restore copied into the restored database: one per Resend
 * send that already left before the restore. A send whose idempotency key
 * hashes to one completes without sending, which is how the restore marks
 * every fenced email complete, whichever job or state transition would repeat
 * it. Content-free like the fence it copies, and swept with the same retention.
 */
export const restoredEmailFences = pgTable(
  "restored_email_fences",
  {
    digest: text("digest").primaryKey(),
    fencedAt: timestamp("fenced_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("restored_email_fences_fenced_at_idx").on(table.fencedAt)],
);
