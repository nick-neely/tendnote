import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";

/**
 * The Temporary Suspension Operator Action's record (#629). An open suspension
 * denies the account admission with no exceptions (ADR 0248) and ends only by
 * its audited lift. Nothing about it reaches Stripe.
 *
 * It ends by its lift, or by the Termination that converts it (#630), which
 * names it. Append-only apart from the one fact learned afterwards: when it
 * was lifted.
 * The reason is the operator's internal note, never shown to the customer and
 * never journaled. An account holds at most one open suspension.
 */
export const temporarySuspensions = pgTable(
  "temporary_suspensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }).notNull().defaultNow(),
    // The internal review deadline set on suspension; renewals are their own records.
    reviewDeadline: timestamp("review_deadline", { withTimezone: true }).notNull(),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
  },
  (table) => [
    index("temporary_suspensions_user_idx").on(table.userId),
    uniqueIndex("temporary_suspensions_one_open_idx")
      .on(table.userId)
      .where(sql`${table.liftedAt} is null`),
  ],
);

/**
 * Each renewal of an open suspension's internal review deadline, audited as its
 * own append-only record with the operator's reason for renewing (#740), an
 * internal note like the suspension's own. The newest one is the deadline now
 * in force.
 */
export const suspensionDeadlineRenewals = pgTable(
  "suspension_deadline_renewals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suspensionId: uuid("suspension_id")
      .notNull()
      .references(() => temporarySuspensions.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    reviewDeadline: timestamp("review_deadline", { withTimezone: true }).notNull(),
    renewedAt: timestamp("renewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("suspension_deadline_renewals_suspension_idx").on(table.suspensionId)],
);
