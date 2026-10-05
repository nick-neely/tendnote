import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { temporarySuspensions } from "./temporary-suspensions";

/**
 * The Termination Operator Action's record (#630). It denies the account
 * admission permanently, with no exceptions (ADR 0248): nothing ends it but
 * deleting the account. An account holds at most one.
 *
 * Append-only apart from the one fact learned afterwards: the Stripe
 * subscription whose renewal the termination stopped. The retention deadline
 * is computed once from `terminatedAt` and stored, as a Lapsed Account's is, so
 * the restricted area, the deletion notices, and the purge read one instant.
 * The reason is the operator's internal note, never shown to the customer and
 * never journaled.
 */
export const terminations = pgTable(
  "terminations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    terminatedAt: timestamp("terminated_at", { withTimezone: true }).notNull().defaultNow(),
    retentionDeadline: timestamp("retention_deadline", { withTimezone: true }).notNull(),
    // The open Temporary Suspension this termination converted, if any: the
    // termination is that suspension's audited end (#631 credits up to it).
    suspensionId: uuid("suspension_id").references(() => temporarySuspensions.id, {
      onDelete: "set null",
    }),
    // The subscription whose renewal was stopped, stored after the Stripe call.
    stripeSubscriptionId: text("stripe_subscription_id"),
  },
  (table) => [index("terminations_suspension_idx").on(table.suspensionId)],
);
