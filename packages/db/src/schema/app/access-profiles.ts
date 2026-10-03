import { sql } from "drizzle-orm";
import { boolean, date, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { accessSource, accessStatus, eveApprovalMode, selfContextOnboardingStatus } from "./enums";

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
    // grant, beta flag rollout, or Paid Access from a first paid invoice.
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
    // This user's Approval Mode for Eve's gated tool calls (#549). It sits here
    // for the same reason the Check-in flag does: the row always exists for an
    // admitted user, so the account control can never succeed against nothing.
    // `ask` is the default and the failure answer - the policy reads this column
    // on every gated call and parks when the read fails, never denies.
    eveApprovalMode: eveApprovalMode("eve_approval_mode").notNull().default("ask"),
    // The one setting that switches off optional telemetry: account funnel
    // events and third-party error reporting. Activation Milestones and
    // operational records are written either way. It sits here because the row
    // always exists for a signed-up account.
    telemetryOptedOut: boolean("telemetry_opted_out").notNull().default(false),
    // The UTC day the account's subscription started, written from its first
    // paid invoice. Its day of the month anchors the Usage Period for monthly
    // and annual subscribers alike; an account without one has no plan, so no
    // plan-derived ceiling applies to it.
    usagePeriodAnchor: date("usage_period_anchor"),
    // When a Lapsed Account's content is deleted unless it is admitted again,
    // written once on entering Lapsed and cleared by any later grant. Its
    // presence on a not-admitted profile is what makes the account Lapsed.
    retentionDeadline: timestamp("retention_deadline", { withTimezone: true }),
    // The Stripe subscription whose first paid invoice granted Paid Access.
    // Only its end lapses the account (#609).
    paidAccessSubscriptionId: text("paid_access_subscription_id"),
    // When the first-run prompt was closed without being answered: skipped, or
    // never owed because the account predates it. Answering needs no column; a
    // first conversation or a first person is the answer (#639).
    firstRunClosedAt: timestamp("first_run_closed_at", { withTimezone: true }),
    // When the owner answered or set aside the integrations offer Home makes
    // once First Value is reached (#639).
    integrationOfferClosedAt: timestamp("integration_offer_closed_at", { withTimezone: true }),
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
