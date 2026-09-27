import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { activationMilestone } from "./enums";

/**
 * Activation Milestones (ADR 0242): when an account first reached each fixed
 * step toward First Value. Operator-facing and content-free - no record id,
 * text, or person - and written whatever the telemetry opt-out says. The key
 * makes each milestone a once-per-account fact.
 */
export const activationMilestones = pgTable(
  "activation_milestones",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    milestone: activationMilestone("milestone").notNull(),
    reachedAt: timestamp("reached_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "activation_milestones_pkey", columns: [table.userId, table.milestone] }),
  ],
);
