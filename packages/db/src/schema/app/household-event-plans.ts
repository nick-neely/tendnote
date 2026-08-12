import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { householdEventPlanLinkKind, householdEventPlanStatus } from "./enums";
import { householdCalendarConnections } from "./household-calendar";
import { householdWorkspaces } from "./households";

/**
 * A household-native record for the coordination around an occasion (ADR 0217).
 *
 * Household-native means the workspace owns it: every active member holds the
 * same authority to edit and archive it, and neither the creator nor a Household
 * Owner holds more. That is why there is no `scope` column - a Plan is always
 * whole-household-visible, and a stored scope would be a value someone could
 * write to narrow a record whose whole point is that it is shared.
 *
 * The calendar reference is an *address* and nothing else: connection, calendar,
 * and provider event id. No title, time, attendee, status, or reminder is copied
 * here. That is the difference between a companion and a mirror - a Plan that
 * cached the event's time would become a second timeline that could disagree
 * with Google, which is exactly what ADR 0217 forbids. When the reference cannot
 * be read, the Plan shows it as unavailable rather than falling back to
 * remembered provider content.
 */
export const householdEventPlans = pgTable(
  "household_event_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => householdWorkspaces.id, { onDelete: "cascade" }),
    /**
     * Provenance, kept factual and kept forever - including after this person
     * leaves. `on delete cascade` follows the account being deleted, not the
     * membership ending: a departed member's authorship survives their departure.
     */
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    lastActorUserId: text("last_actor_user_id").references(() => user.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    details: text("details"),
    /** The household's own note of when. Never derived from the provider event. */
    plannedFor: timestamp("planned_for", { withTimezone: true }),
    status: householdEventPlanStatus("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * `set null` rather than cascade: losing the calendar must not delete the
     * household's planning. The Plan survives with its reference emptied, which
     * is the "unavailable provider reference" the contract asks for.
     */
    calendarConnectionId: uuid("calendar_connection_id").references(
      () => householdCalendarConnections.id,
      { onDelete: "set null" },
    ),
    calendarId: text("calendar_id"),
    calendarProviderEventId: text("calendar_provider_event_id"),
    /** Optimistic-concurrency fence; bumped on every material write. */
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    /** The Household read path: this household's active plans, soonest first. */
    index("household_event_plans_household_status_idx").on(
      table.householdId,
      table.status,
      table.plannedFor,
    ),
    /** "Is this event already planned?" on a calendar event, without a scan. */
    index("household_event_plans_calendar_event_idx").on(
      table.calendarConnectionId,
      table.calendarProviderEventId,
    ),
  ],
);

/**
 * A Plan's link to an existing record, which explains rather than absorbs it.
 *
 * The link carries no authority and no copy: completing a linked Action does not
 * change the Plan or the calendar event, and reading the Plan does not grant
 * access to the linked record. Every link is proved on its own facts before it
 * is revealed (ADR 0219), so a member who cannot see the Action simply does not
 * see that row - not a placeholder, not a count.
 */
export const householdEventPlanLinks = pgTable(
  "household_event_plan_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => householdEventPlans.id, { onDelete: "cascade" }),
    linkKind: householdEventPlanLinkKind("link_kind").notNull(),
    recordId: uuid("record_id").notNull(),
    linkedByUserId: text("linked_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** Linking the same record twice is one link, not two. */
    uniqueIndex("household_event_plan_links_record_idx").on(
      table.planId,
      table.linkKind,
      table.recordId,
    ),
    index("household_event_plan_links_plan_idx").on(table.planId),
  ],
);
