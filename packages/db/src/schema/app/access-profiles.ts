import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
    // local bootstrap, self-hosted bootstrap, Household invitation, manual
    // grant, or beta flag rollout.
    source: accessSource("source"),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    selfContextOnboardingStatus: selfContextOnboardingStatus("self_context_onboarding_status")
      .notNull()
      .default("not_started"),
    selfContextOnboardingReminderAt: timestamp("self_context_onboarding_reminder_at", {
      withTimezone: true,
    }),
    // The member's own opt-in to a Household Check-in in their private briefing
    // (#390). It sits here because this row always exists for an admitted member,
    // so the control can never succeed against nothing (ADR 0220).
    householdCheckinEnabled: boolean("household_checkin_enabled").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    // Local demo bootstrap and self-hosted bootstrap are each singleton sources.
    // These partial unique indexes keep explicit owner grants race-safe without
    // making ordinary pending profile creation depend on arrival order.
    uniqueIndex("access_profiles_single_bootstrap_idx")
      .on(table.source)
      .where(sql`${table.source} = 'bootstrap'`),
    uniqueIndex("access_profiles_single_self_hosted_bootstrap_idx")
      .on(table.source)
      .where(sql`${table.source} = 'self_hosted_bootstrap'`),
  ],
);
