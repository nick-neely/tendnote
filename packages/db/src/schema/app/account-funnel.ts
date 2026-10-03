import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { accountFunnelStage } from "./enums";

/**
 * An account enrolled in the optional account funnel, and the dedicated opaque
 * identifier its events carry instead of the account's own id. A row exists
 * only once a known-US request from the account has started a funnel stage, so
 * an account without one has no funnel to record into. Deleting the account
 * deletes the row and every event under it.
 */
export const funnelAccounts = pgTable("funnel_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique("funnel_accounts_user_id_unique")
    .references(() => user.id, { onDelete: "cascade" }),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Whether the account's most recent signup or checkout request came from a
   * known-US region. Payment, admission, and milestone stages have no request
   * of their own to read, so they follow this.
   */
  regionEligible: boolean("region_eligible").notNull().default(true),
});

/**
 * Account funnel events: that an enrolled account first reached one fixed
 * stage, and when. Content-free - no name, email, record id, URL, or text - and
 * once per account and stage, so a redelivered webhook cannot count twice.
 * Deleted after the retention constant, or with the account.
 */
export const accountFunnelEvents = pgTable(
  "account_funnel_events",
  {
    funnelAccountId: uuid("funnel_account_id")
      .notNull()
      .references(() => funnelAccounts.id, { onDelete: "cascade" }),
    stage: accountFunnelStage("stage").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "account_funnel_events_pkey",
      columns: [table.funnelAccountId, table.stage],
    }),
    index("account_funnel_events_occurred_at_idx").on(table.occurredAt),
  ],
);
