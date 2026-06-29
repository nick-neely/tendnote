import { randomUUID } from "node:crypto";
import type { CalendarSuggestedFollowup } from "@tendnote/domain";
import type { CalendarSuggestionAuditLogEntry, CalendarSuggestionStore } from "./types";

export type InMemoryCalendarSuggestionStore = CalendarSuggestionStore & {
  listAuditLogEntries: (ownerUserId: string) => Promise<CalendarSuggestionAuditLogEntry[]>;
};

export function createInMemoryCalendarSuggestionStore(
  seed: CalendarSuggestedFollowup[] = [],
): InMemoryCalendarSuggestionStore {
  const rows = new Map<string, CalendarSuggestedFollowup>(seed.map((row) => [row.id, row]));
  const audit: CalendarSuggestionAuditLogEntry[] = [];

  const owned = (ownerUserId: string) =>
    [...rows.values()].filter((row) => row.ownerUserId === ownerUserId);

  return {
    async listExistingDedupeKeys(ownerUserId) {
      return new Set(owned(ownerUserId).map((row) => row.dedupeKey));
    },

    async createSuggestion(input) {
      const now = new Date();
      const row: CalendarSuggestedFollowup = {
        ...input,
        id: randomUUID(),
        status: "suggested",
        acceptedFollowupId: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return row;
    },

    async getSuggestion({ ownerUserId, id }) {
      const row = rows.get(id);
      return row && row.ownerUserId === ownerUserId ? row : null;
    },

    async listSuggestions({ ownerUserId, status }) {
      return owned(ownerUserId)
        .filter((row) => (status ? row.status === status : true))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },

    async updateSuggestion({ ownerUserId, id, patch }) {
      const row = rows.get(id);
      if (!row || row.ownerUserId !== ownerUserId) {
        return null;
      }
      const updated: CalendarSuggestedFollowup = {
        ...row,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.acceptedFollowupId !== undefined
          ? { acceptedFollowupId: patch.acceptedFollowupId }
          : {}),
        updatedAt: new Date(),
      };
      rows.set(id, updated);
      return updated;
    },

    async createAuditLogEntry(entry) {
      audit.push(entry);
    },

    async listAuditLogEntries(ownerUserId) {
      return audit.filter((entry) => entry.ownerUserId === ownerUserId);
    },
  };
}
