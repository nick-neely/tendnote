import { bigint, date, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { costCategory } from "./enums";

/**
 * The Account Ceiling override Operator Action's record (#633): the operator
 * raised one cost category's Account Ceiling for the Usage Period running when
 * it was granted, and it expires when that period resets. Append-only; a second
 * raise in the same period is a second record, and the highest one applies.
 * Identifiers and amounts only.
 */
export const accountCeilingOverrides = pgTable(
  "account_ceiling_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    costCategory: costCategory("cost_category").notNull(),
    ceilingMicroUsd: bigint("ceiling_micro_usd", { mode: "number" }).notNull(),
    /** The Usage Period it raises: from its first day to the day it resets, exclusive. */
    periodStart: date("period_start").notNull(),
    expiresOn: date("expires_on").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A retried raise names the same period and figure, so it finds its record.
    uniqueIndex("account_ceiling_overrides_raise_unique").on(
      table.userId,
      table.costCategory,
      table.periodStart,
      table.ceilingMicroUsd,
    ),
  ],
);
