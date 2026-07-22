import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { todayFeedbackKind } from "./enums";

export const todayFeedback = pgTable(
  "today_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    candidateIdentity: text("candidate_identity").notNull(),
    reasonKey: text("reason_key").notNull(),
    kind: todayFeedbackKind("kind").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    suppressUntil: timestamp("suppress_until", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("today_feedback_candidate_reason_kind_idx").on(
      table.ownerUserId,
      table.candidateIdentity,
      table.reasonKey,
      table.kind,
    ),
    index("today_feedback_owner_local_date_idx").on(table.ownerUserId, table.localDate),
    index("today_feedback_owner_suppress_until_idx").on(table.ownerUserId, table.suppressUntil),
  ],
);
