import type { CalendarEventSummary } from "@tendnote/domain";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { householdCalendarConnectionStatus, householdCalendarDisconnectReason } from "./enums";
import { householdWorkspaces } from "./households";

/**
 * A Household Owner's explicit designation of one provider calendar as readable
 * by the whole active Household (Phase Eight, ADR 0217).
 *
 * There is no credential here, and there is deliberately no column that could
 * become one: no token, no refresh token, no scope mirror, no provider account
 * id. The connection names the *member* whose own Google grant it reads through,
 * and that member's grant stays where Better Auth already keeps it. Removing
 * this row therefore removes an audience, never an authorization - which is why
 * disconnect can be a status transition rather than a revocation.
 *
 * `connector_user_id` is a technical fact and never an authority one. Nothing in
 * the product reads it to decide who may edit an Event Plan or who governs the
 * connection; that is the Household Owner role and the Authorization Proof.
 */
export const householdCalendarConnections = pgTable(
  "household_calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => householdWorkspaces.id, { onDelete: "cascade" }),
    /** Whose provider grant this reads through. A connector, not a content authority. */
    connectorUserId: text("connector_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The Owner who made the whole-household designation. History; it does not change. */
    designatedByUserId: text("designated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    providerKey: text("provider_key").notNull(),
    capabilityKey: text("capability_key").notNull(),
    calendarId: text("calendar_id").notNull(),
    /** The household's own name for it, not the provider's. */
    label: text("label").notNull(),
    status: householdCalendarConnectionStatus("status").notNull().default("connected"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    disconnectedReason: householdCalendarDisconnectReason("disconnected_reason"),
    ...timestamps,
  },
  (table) => [
    /**
     * One row per household + connector + calendar, terminal or not. Reconnecting
     * the same calendar reuses this row rather than accumulating a history of
     * designations, so "is this calendar shared here" has exactly one answer and
     * the unique key does not need a partial predicate to stay true.
     */
    uniqueIndex("household_calendar_connections_calendar_idx").on(
      table.householdId,
      table.connectorUserId,
      table.providerKey,
      table.capabilityKey,
      table.calendarId,
    ),
    /** The household read path: this household's connected calendars. */
    index("household_calendar_connections_household_status_idx").on(
      table.householdId,
      table.status,
    ),
    /** The departure path: every connection riding a leaving member's grant. */
    index("household_calendar_connections_connector_idx").on(
      table.householdId,
      table.connectorUserId,
    ),
  ],
);

/**
 * The Household read cache, kept deliberately apart from `calendar_event_cache`.
 *
 * A separate table rather than a household column on the owner-scoped cache,
 * because the two have different authorization, different lifetimes, and
 * different clearing events, and one row set serving both would mean an
 * owner-scoped read could be answered from a household entry or the reverse.
 * ADR 0217's rule is that the existing owner-scoped reader is not widened
 * implicitly; separate cache identity is what makes that structural instead of
 * a convention someone has to keep.
 *
 * Same minimization contract as the owner-scoped cache (ADR-0075, ADR-0079):
 * minimized summaries only, no raw payloads, no sync cursor, no embedding, and
 * not retrieval truth. Rows cascade with the connection, so disconnect,
 * connector departure, and dissolution all clear this by clearing that.
 */
export const householdCalendarEventCache = pgTable(
  "household_calendar_event_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => householdCalendarConnections.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    windowKey: text("window_key").notNull(),
    events: jsonb("events").$type<CalendarEventSummary[]>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("household_calendar_event_cache_key_idx").on(
      table.connectionId,
      table.calendarId,
      table.windowKey,
    ),
    /** Supports the post-read prune that keeps a moving window bounded. */
    index("household_calendar_event_cache_fetched_at_idx").on(table.connectionId, table.fetchedAt),
  ],
);
