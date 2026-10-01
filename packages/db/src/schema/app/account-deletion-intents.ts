import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth";

/**
 * A committed self-service deletion that has not finished (#616).
 *
 * The account closes the moment this row commits: admission reads it as a
 * block, and sessions are revoked. The Deletion Record is then written to the
 * Recovery Journal (`journaled_at`), and only then are the account's rows
 * deleted - which removes this row with them, so an intent that still exists
 * is by definition incomplete. Content-free: an account and two moments.
 */
export const accountDeletionIntents = pgTable(
  "account_deletion_intents",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    journaledAt: timestamp("journaled_at", { withTimezone: true }),
    /** The recovery sweep's last attempt, so a failing intent cannot starve the rest. */
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
  },
  (table) => [
    index("account_deletion_intents_retry_order_idx").on(table.attemptedAt, table.requestedAt),
  ],
);
