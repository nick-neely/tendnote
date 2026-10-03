import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth";

/**
 * Tendnote's local projection of an account's Stripe subscriptions (#609, ADR
 * 0245), so the request path can show its Ending and Past Due notices without
 * asking Stripe.
 *
 * One row per subscription, because a resubscription is a new subscription and
 * the ended one must still be recognised: its redelivered first invoice may
 * never admit the account again. `ended_at` is terminal, as a cancelled Stripe
 * subscription is, so a stale snapshot can never revive it. Like
 * `stripe_customers` it holds no billing detail or record content.
 */
export const stripeSubscriptions = pgTable(
  "stripe_subscriptions",
  {
    stripeSubscriptionId: text("stripe_subscription_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // When a scheduled cancellation takes effect; null when none is scheduled.
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    // When the subscription ended; null while it lives.
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // The renewal invoice whose failed payment made the subscription Past Due
    // (#610), and when it failed; both null while payments succeed. The
    // invoice names the dunning window, so an extension can cover only it.
    pastDueInvoiceId: text("past_due_invoice_id"),
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("stripe_subscriptions_user_idx").on(table.userId)],
);
