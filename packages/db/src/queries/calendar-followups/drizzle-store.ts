import type { CalendarSuggestedFollowup } from "@tendnote/domain";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { auditLog, calendarSuggestedFollowups, contactMethods, people } from "../../schema";
import type { CalendarPeopleMatcher, CalendarSuggestionStore } from "./types";

type Row = typeof calendarSuggestedFollowups.$inferSelect;

function toDomain(row: Row): CalendarSuggestedFollowup {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    providerEventId: row.providerEventId,
    calendarId: row.calendarId,
    shape: row.shape,
    personId: row.personId,
    personDisplayName: row.personDisplayName,
    matchKind: row.matchKind,
    tentative: row.tentative,
    unresolvedAttendee: row.unresolvedAttendee,
    reason: row.reason,
    dueAt: row.dueAt,
    dedupeKey: row.dedupeKey,
    status: row.status,
    acceptedFollowupId: row.acceptedFollowupId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleCalendarSuggestionStore(): CalendarSuggestionStore {
  return {
    async listExistingDedupeKeys(ownerUserId) {
      const rows = await getDb()
        .select({ dedupeKey: calendarSuggestedFollowups.dedupeKey })
        .from(calendarSuggestedFollowups)
        .where(eq(calendarSuggestedFollowups.ownerUserId, ownerUserId));
      return new Set(rows.map((row) => row.dedupeKey));
    },

    async createSuggestion(input) {
      // Conflict-safe against the (owner, dedupe_key) unique index: a concurrent
      // run that already inserted this key yields no row, and the caller skips it.
      const [row] = await getDb()
        .insert(calendarSuggestedFollowups)
        .values({ ...input, status: "suggested", acceptedFollowupId: null })
        .onConflictDoNothing({
          target: [calendarSuggestedFollowups.ownerUserId, calendarSuggestedFollowups.dedupeKey],
        })
        .returning();
      return row ? toDomain(row) : null;
    },

    async getSuggestion({ ownerUserId, id }) {
      const [row] = await getDb()
        .select()
        .from(calendarSuggestedFollowups)
        .where(
          and(
            eq(calendarSuggestedFollowups.ownerUserId, ownerUserId),
            eq(calendarSuggestedFollowups.id, id),
          ),
        )
        .limit(1);
      return row ? toDomain(row) : null;
    },

    async listSuggestions({ ownerUserId, status }) {
      const where = status
        ? and(
            eq(calendarSuggestedFollowups.ownerUserId, ownerUserId),
            eq(calendarSuggestedFollowups.status, status),
          )
        : eq(calendarSuggestedFollowups.ownerUserId, ownerUserId);
      const rows = await getDb()
        .select()
        .from(calendarSuggestedFollowups)
        .where(where)
        .orderBy(calendarSuggestedFollowups.createdAt);
      return rows.map(toDomain);
    },

    async updateSuggestion({ ownerUserId, id, patch }) {
      const [row] = await getDb()
        .update(calendarSuggestedFollowups)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(calendarSuggestedFollowups.ownerUserId, ownerUserId),
            eq(calendarSuggestedFollowups.id, id),
          ),
        )
        .returning();
      return row ? toDomain(row) : null;
    },

    async createAuditLogEntry(entry) {
      await getDb().insert(auditLog).values(entry);
    },
  };
}

/**
 * Owner-scoped people matcher backed by the database (ADR-0078). Email matches join
 * `contact_methods`; name matches use the person's display name. Both are
 * case-insensitive exact matches and never create people.
 */
export function createDrizzleCalendarPeopleMatcher(): CalendarPeopleMatcher {
  return {
    async findPeopleByEmail(ownerUserId, email) {
      // Case-insensitive EXACT match (not ILIKE) so `_`/`%` in an attendee email are
      // never treated as wildcards — a wrong-person link would be a real harm (ADR-0078).
      return getDb()
        .select({ id: people.id, displayName: people.displayName })
        .from(people)
        .innerJoin(contactMethods, eq(contactMethods.personId, people.id))
        .where(
          and(
            eq(people.ownerUserId, ownerUserId),
            eq(contactMethods.type, "email"),
            eq(sql`lower(${contactMethods.value})`, email.toLowerCase()),
          ),
        );
    },

    async findPeopleByName(ownerUserId, displayName) {
      return getDb()
        .select({ id: people.id, displayName: people.displayName })
        .from(people)
        .where(
          and(
            eq(people.ownerUserId, ownerUserId),
            eq(sql`lower(${people.displayName})`, displayName.toLowerCase()),
          ),
        );
    },
  };
}
