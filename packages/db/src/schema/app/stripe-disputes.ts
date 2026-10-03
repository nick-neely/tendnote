import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth";

/**
 * Disputes Stripe reported on a subscription's payment (#617). Each is an
 * admission block on the disputed subscription, excepted only by an admission
 * exception naming it (ADR 0248), so a later dispute is never covered by an
 * earlier re-admission. Identifiers and times only.
 */
export const stripeDisputes = pgTable(
  "stripe_disputes",
  {
    stripeDisputeId: text("stripe_dispute_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    // Whether Tendnote scheduled the subscription's period-end cancellation for
    // this dispute, so a re-admission resumes only a renewal it stopped and
    // never one the customer cancelled themselves.
    renewalStopped: boolean("renewal_stopped").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("stripe_disputes_subscription_idx").on(table.stripeSubscriptionId)],
);
