import type { CalendarAttendeeMatchKind, CalendarSuggestionShape } from "@tendnote/domain";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { calendarSuggestionStatus } from "./enums";
import { people } from "./people";

/**
 * Calendar-derived suggested follow-ups (Phase 2C, ADR-0077/0078/0082).
 *
 * Proactive, reviewable suggestions from recent meetings. Persisted as `suggested`
 * and never active until accepted. Deduped per owner by a stable key (provider
 * event + calendar + person/contact signal + shape) so the same meeting never
 * re-nudges and a dismissed suggestion is not reintroduced. Resolved attendees link
 * to an existing person; unresolved attendees are link-needed context only (no
 * durable person link). Stores no raw provider payload.
 */
export const calendarSuggestedFollowups = pgTable(
  "calendar_suggested_followups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id").notNull(),
    calendarId: text("calendar_id").notNull(),
    shape: text("shape").$type<CalendarSuggestionShape>().notNull(),
    // Resolved person link (null when the attendee is unresolved). Calendar never
    // auto-creates people (ADR-0078); this points only at an existing person.
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    personDisplayName: text("person_display_name"),
    matchKind: text("match_kind").$type<CalendarAttendeeMatchKind>().notNull(),
    tentative: boolean("tentative").notNull().default(false),
    unresolvedAttendee: text("unresolved_attendee"),
    reason: text("reason").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: calendarSuggestionStatus("status").notNull().default("suggested"),
    acceptedFollowupId: uuid("accepted_followup_id"),
    ...timestamps,
  },
  (table) => [
    index("calendar_suggested_followups_owner_idx").on(table.ownerUserId),
    index("calendar_suggested_followups_owner_status_idx").on(table.ownerUserId, table.status),
    // One suggestion per owner + dedupe key — the dedupe + no-reintroduction guard.
    uniqueIndex("calendar_suggested_followups_owner_dedupe_idx").on(
      table.ownerUserId,
      table.dedupeKey,
    ),
  ],
);
