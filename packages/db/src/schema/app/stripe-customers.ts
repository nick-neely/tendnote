import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth";

/**
 * The one Stripe customer that belongs to a hosted account (#606, ADR 0245).
 *
 * It is written before Checkout opens, so every later Stripe event names a
 * customer Tendnote already knows and can be projected onto its account in any
 * delivery order. It holds identifiers only: Stripe is the record of money, and
 * no billing detail or record content is copied here.
 */
export const stripeCustomers = pgTable("stripe_customers", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
