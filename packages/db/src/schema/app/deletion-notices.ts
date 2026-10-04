import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { deletionNoticeStage } from "./enums";

/**
 * Where an account with a retention deadline is in its deletion-notice
 * sequence (#621): the last notice it was sent, and when the sweep last took
 * it up, both for one deadline. Content-free: an account, a deadline, a stage,
 * and moments.
 *
 * Keyed to the deadline rather than cleared on resubscribing, so no grant path
 * has to remember it: an account that lapses again gets a new deadline, and a
 * row naming the old one no longer counts.
 */
export const deletionNotices = pgTable("deletion_notices", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  retentionDeadline: timestamp("retention_deadline", { withTimezone: true }).notNull(),
  // Null until the first notice for this deadline is sent.
  stage: deletionNoticeStage("stage"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  // The sweep's last attempt, so an account that keeps failing or is refused
  // moves behind the rest instead of holding the pass's budget.
  attemptedAt: timestamp("attempted_at", { withTimezone: true }),
});
