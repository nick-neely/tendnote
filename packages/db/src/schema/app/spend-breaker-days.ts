import { bigint, date, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

/**
 * The Spend Breaker's days (ADR 0246, ADR 0255): one row per UTC day holding
 * the ceiling computed from that day's admitted accounts, and when each stage
 * first shed. A stage's timestamp is the trip record the operator alert channel
 * reads. It is deployment-wide and content-free: no account, record, or prompt.
 */
export const spendBreakerDays = pgTable("spend_breaker_days", {
  /** The UTC calendar day, matching the Usage Ledger's days. */
  day: date("day").primaryKey(),
  /** Accounts admitted when the day's ceiling was computed. */
  admittedAccounts: integer("admitted_accounts").notNull(),
  /** The day's ceiling, in millionths of a dollar. */
  ceilingMicroUsd: bigint("ceiling_micro_usd", { mode: "number" }).notNull(),
  /** When the breaker tripped and background extraction and embeddings shed. */
  backgroundShedAt: timestamp("background_shed_at", { withTimezone: true }),
  /** When scheduled workflows shed. */
  scheduledShedAt: timestamp("scheduled_shed_at", { withTimezone: true }),
  /** When interactive Eve shed, last. */
  interactiveShedAt: timestamp("interactive_shed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
