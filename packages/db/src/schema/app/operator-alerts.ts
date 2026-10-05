import type { OperatorAlertCondition } from "@tendnote/domain/operator-alerts";
import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * One episode of an operator alert condition (#648): from when it started
 * firing to when it cleared, and when each of its two notices was sent. At most
 * one episode per condition is open, which is what deduplicates the alert
 * across passes. Deployment-wide and content-free: no account or record.
 */
export const operatorAlerts = pgTable(
  "operator_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    condition: text("condition").$type<OperatorAlertCondition>().notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    /** When the alert was claimed for sending; cleared again if the send failed. */
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    /** When the recovery notice was claimed for sending, likewise. */
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("operator_alerts_open_condition_idx")
      .on(table.condition)
      .where(sql`${table.clearedAt} is null`),
  ],
);
