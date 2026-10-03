import { date, integer, pgTable, primaryKey } from "drizzle-orm/pg-core";
import { publicActivityEvent, publicPage } from "./enums";

/**
 * Anonymous public activity: one running total per UTC day, fixed event, and
 * fixed page. There is no row per visit, no visitor or account identifier, and
 * no column that could hold one, so a count can never be joined back to a
 * person. Deleted after the thirteen-month retention constant.
 */
export const publicActivityDailyCounts = pgTable(
  "public_activity_daily_counts",
  {
    day: date("day", { mode: "string" }).notNull(),
    event: publicActivityEvent("event").notNull(),
    page: publicPage("page").notNull(),
    count: integer("count").notNull().default(1),
  },
  (table) => [
    primaryKey({
      name: "public_activity_daily_counts_pkey",
      columns: [table.day, table.event, table.page],
    }),
  ],
);
