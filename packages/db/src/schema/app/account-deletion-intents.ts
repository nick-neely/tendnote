import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { accountDeletionReason } from "./enums";

/**
 * A committed account deletion that has not finished: the owner's own (#616),
 * or the purge of an account whose retention deadline passed (#621).
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
    // A retention-deadline purge is confirmed by email once the rows are gone.
    reason: accountDeletionReason("reason").notNull().default("owner_request"),
    journaledAt: timestamp("journaled_at", { withTimezone: true }),
    /** The recovery sweep's last attempt, so a failing intent cannot starve the rest. */
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
  },
  (table) => [
    index("account_deletion_intents_retry_order_idx").on(table.attemptedAt, table.requestedAt),
  ],
);
