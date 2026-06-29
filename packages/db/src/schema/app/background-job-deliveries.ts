import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { backgroundJobDeliveryStatus, backgroundJobKind } from "./enums";

export const backgroundJobDeliveries = pgTable(
  "background_job_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    jobKind: backgroundJobKind("job_kind").notNull(),
    jobId: uuid("job_id").notNull(),
    topic: text("topic").notNull(),
    status: backgroundJobDeliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("background_job_deliveries_job_topic_idx").on(
      table.jobKind,
      table.jobId,
      table.topic,
    ),
    index("background_job_deliveries_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("background_job_deliveries_owner_status_idx").on(table.ownerUserId, table.status),
    index("background_job_deliveries_job_idx").on(table.jobKind, table.jobId),
  ],
);
