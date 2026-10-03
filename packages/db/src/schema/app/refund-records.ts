import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";

/**
 * The Refund Operator Action's record (ADR 0249): written before the Stripe
 * refund is created, so a refund that succeeds while its response is lost is
 * still explained. A Stripe refund revokes Paid Access only when it matches one
 * of these, and only on the subscription the record names (#617).
 *
 * Append-only apart from the two facts learned afterwards: the Stripe refund id
 * once the call returns or reconciliation matches it, and when the revocation
 * it asked for was applied. Identifiers and an amount only; no record content.
 */
export const refundRecords = pgTable(
  "refund_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    // The payment refunded, which is what a refund whose id was never stored
    // is matched on, with the amount and the time.
    paymentIntentId: text("payment_intent_id").notNull(),
    // In the smallest currency unit, as Stripe states it.
    amount: integer("amount").notNull(),
    // A Refund always goes back to the card that paid.
    instrument: text("instrument").$type<"card">().notNull().default("card"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    stripeRefundId: text("stripe_refund_id").unique(),
    // When Paid Access was revoked and the confirmation sent, so a later pass
    // over the same refund changes and sends nothing.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("refund_records_subscription_idx").on(table.stripeSubscriptionId),
    index("refund_records_payment_intent_idx").on(table.paymentIntentId),
  ],
);
