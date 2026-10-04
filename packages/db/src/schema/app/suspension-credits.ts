import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { temporarySuspensions } from "./temporary-suspensions";
import { terminations } from "./terminations";

/**
 * The Suspension Credit Operator Action's record (#631, ADR 0249): one per
 * credit note, so one per paid invoice the suspended time overlapped, written
 * before the credit note is created. A Stripe refund matching one never
 * revokes Paid Access: it is compensation for denied service, not the
 * unwinding of a sale.
 *
 * The exit it was issued at is the lift of `suspensionId`, or the Termination
 * `terminationId`, which also names the suspension it converted, if any. An
 * exit credits an invoice at most once.
 *
 * Append-only apart from the facts learned afterwards: the credit note once
 * the call returns, and the refund it made, once the call returns or
 * reconciliation matches it. Identifiers and amounts only; no record content.
 */
export const suspensionCredits = pgTable(
  "suspension_credits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    suspensionId: uuid("suspension_id").references(() => temporarySuspensions.id, {
      onDelete: "set null",
    }),
    terminationId: uuid("termination_id").references(() => terminations.id, {
      onDelete: "set null",
    }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    invoiceLineItemId: text("invoice_line_item_id").notNull(),
    // The payment a card refund goes back to, which is what a refund whose id
    // was never stored is matched on, with the amount and the time.
    paymentIntentId: text("payment_intent_id"),
    // The credited line amounts, in the smallest currency unit: the suspended
    // time, and a Termination's unused remainder to the period end.
    suspendedAmount: integer("suspended_amount").notNull(),
    remainderAmount: integer("remainder_amount").notNull(),
    // The credit note's total with its tax, which is what the instrument moves.
    amount: integer("amount").notNull(),
    // `balance` onto the customer credit balance when a future invoice will
    // consume it, `card` back to the card otherwise.
    instrument: text("instrument").$type<"balance" | "card">().notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    stripeCreditNoteId: text("stripe_credit_note_id").unique(),
    stripeRefundId: text("stripe_refund_id").unique(),
  },
  (table) => [
    index("suspension_credits_user_idx").on(table.userId),
    index("suspension_credits_payment_intent_idx").on(table.paymentIntentId),
    uniqueIndex("suspension_credits_lift_invoice_idx")
      .on(table.suspensionId, table.invoiceId)
      .where(sql`${table.terminationId} is null`),
    uniqueIndex("suspension_credits_termination_invoice_idx")
      .on(table.terminationId, table.invoiceId)
      .where(sql`${table.terminationId} is not null`),
  ],
);
