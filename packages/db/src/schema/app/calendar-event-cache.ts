import type { CalendarEventSummary } from "@tendnote/domain";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";

/**
 * Short-lived, minimized Google Calendar read cache (Phase 2C, ADR-0075, ADR-0079).
 *
 * Live Google Calendar is the source of truth; this is a performance/reliability/
 * rate-control aid keyed by owner, provider connection (provider + capability),
 * calendar id, and a bounded window/query shape. It stores ONLY normalized minimized
 * event summaries — never raw Google event payloads — and expires aggressively.
 *
 * NOT retrieval truth (ADR-0079): cached events are not approved memory or retained
 * source records and must not enter full-text or semantic retrieval unless promoted
 * into durable Tendnote state. There is intentionally no embedding, tsvector, raw
 * payload, or sync-cursor column here.
 *
 * Freshness is enforced by the reader (TTL/stale-max), not by deleting rows: an
 * expired row is simply re-fetched and overwritten in place. The `expires_at` index
 * supports both that lookup and physical pruning; a background sweeper is deferred
 * until a concrete workflow needs it, and disconnect clears an owner's rows (#109).
 */
export const calendarEventCache = pgTable(
  "calendar_event_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Provider connection identity (matches provider_connections' generic keys).
    providerKey: text("provider_key").notNull(),
    capabilityKey: text("capability_key").notNull(),
    // Carried through from day one even though Phase 2C defaults to "primary".
    calendarId: text("calendar_id").notNull(),
    // Deterministic key for the bounded window/query shape (calendarWindowKey).
    windowKey: text("window_key").notNull(),
    // Minimized summaries only (CalendarEventSummary[]); dates serialize as ISO and
    // are coerced back to Date on read via the domain schema. No raw payloads.
    events: jsonb("events").$type<CalendarEventSummary[]>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("calendar_event_cache_owner_user_id_idx").on(table.ownerUserId),
    index("calendar_event_cache_expires_at_idx").on(table.expiresAt),
    // One cache row per owner + connection + calendar + window/query shape.
    uniqueIndex("calendar_event_cache_key_idx").on(
      table.ownerUserId,
      table.providerKey,
      table.capabilityKey,
      table.calendarId,
      table.windowKey,
    ),
  ],
);
