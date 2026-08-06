import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { accessSource, accessStatus, selfContextOnboardingStatus } from "./enums";

/**
 * Tendnote-owned account/access profile. Records durable Private Beta Access for
 * a Better Auth user so admission does not depend on brittle "oldest user"
 * queries. It is the natural home for future account metadata (billing, roles).
 */
export const accessProfiles = pgTable(
  "access_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    status: accessStatus("status").notNull().default("pending"),
    // Set when access is granted; explains whether admission came from the
    // first-user bootstrap, a manual grant, or a beta flag rollout.
    source: accessSource("source"),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    selfContextOnboardingStatus: selfContextOnboardingStatus("self_context_onboarding_status")
      .notNull()
      .default("not_started"),
    selfContextOnboardingReminderAt: timestamp("self_context_onboarding_reminder_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    // The "initial allowed owner" is singular: at most one bootstrap profile can
    // ever exist. This partial unique index makes first-user bootstrap atomic so
    // two concurrent first signups cannot both win admission.
    uniqueIndex("access_profiles_single_bootstrap_idx")
      .on(table.source)
      .where(sql`${table.source} = 'bootstrap'`),
  ],
);
