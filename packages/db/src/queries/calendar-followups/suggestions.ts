import type { CalendarEventSummary, CalendarSuggestedFollowup } from "@tendnote/domain";
import { generateCalendarSuggestionCandidates } from "./pipeline";
import type {
  CalendarPeopleMatcher,
  CalendarSuggestionClassifier,
  CalendarSuggestionStore,
} from "./types";

const ENTITY_TYPE = "calendar_suggested_followup";

/**
 * Owner-scoped Calendar suggested-follow-up generation and review (ADR-0077). The
 * deterministic pipeline produces capped, deduped candidates; only fresh ones (no
 * existing dedupe key — including dismissed/accepted) are persisted as `suggested`.
 * Accept promotes through the existing follow-up lifecycle (an injected active-
 * follow-up create); dismiss marks the suggestion dismissed so its dedupe key blocks
 * re-suggestion. Nothing becomes an active reminder without acceptance.
 */
export function createCalendarSuggestionReview(store: CalendarSuggestionStore) {
  return {
    /** Generate + persist fresh suggestions from recent connected-calendar events. */
    async generateSuggestions(
      input: { ownerUserId: string; events: readonly CalendarEventSummary[]; now?: Date },
      deps: {
        matcher: CalendarPeopleMatcher;
        classify?: CalendarSuggestionClassifier;
        maxPerRun?: number;
      },
    ): Promise<CalendarSuggestedFollowup[]> {
      const now = input.now ?? new Date();
      // Existing keys (any status) are excluded BEFORE the per-run cap so a
      // dismissed/accepted meeting never crowds out a fresh suggestion.
      const existing = await store.listExistingDedupeKeys(input.ownerUserId);
      const candidates = await generateCalendarSuggestionCandidates(
        { ownerUserId: input.ownerUserId, events: input.events, now },
        {
          matcher: deps.matcher,
          classify: deps.classify,
          maxPerRun: deps.maxPerRun,
          excludeKeys: existing,
        },
      );

      const persisted: CalendarSuggestedFollowup[] = [];

      for (const candidate of candidates) {
        const row = await store.createSuggestion({
          ownerUserId: input.ownerUserId,
          providerEventId: candidate.providerEventId,
          calendarId: candidate.calendarId,
          shape: candidate.shape,
          personId: candidate.personId,
          personDisplayName: candidate.personDisplayName,
          matchKind: candidate.matchKind,
          tentative: candidate.tentative,
          unresolvedAttendee: candidate.unresolvedAttendee,
          reason: candidate.reason,
          dueAt: candidate.dueAt,
          dedupeKey: candidate.dedupeKey,
        });

        // A concurrent run may have already inserted this key (unique index +
        // conflict-do-nothing): skip silently rather than double-suggesting.
        if (!row) {
          continue;
        }

        await store.createAuditLogEntry({
          ownerUserId: input.ownerUserId,
          action: "calendar_followup.suggest",
          entityType: ENTITY_TYPE,
          entityId: row.id,
          metadataJson: {
            providerEventId: row.providerEventId,
            matchKind: row.matchKind,
            personId: row.personId,
          },
        });

        persisted.push(row);
      }

      return persisted;
    },

    /** The owner's reviewable (suggested) Calendar follow-ups. */
    async listSuggestedFollowups(ownerUserId: string): Promise<CalendarSuggestedFollowup[]> {
      return store.listSuggestions({ ownerUserId, status: "suggested" });
    },

    /**
     * Accept a suggestion: promote it into the existing follow-up lifecycle by
     * creating an active follow-up for the resolved person, then mark the suggestion
     * accepted. Unresolved suggestions cannot be accepted (no durable person link).
     */
    async acceptSuggestedFollowup(
      input: { ownerUserId: string; id: string },
      deps: {
        createActiveFollowup: (input: {
          ownerUserId: string;
          personId: string;
          reason: string;
          dueAt: Date;
        }) => Promise<{ id: string }>;
      },
    ): Promise<CalendarSuggestedFollowup> {
      const suggestion = await store.getSuggestion(input);
      if (!suggestion || suggestion.status !== "suggested") {
        throw new Error("Only suggested Calendar follow-ups can be accepted.");
      }
      if (!suggestion.personId) {
        throw new Error("Resolve the attendee to a person before accepting this suggestion.");
      }

      const followup = await deps.createActiveFollowup({
        ownerUserId: input.ownerUserId,
        personId: suggestion.personId,
        reason: suggestion.reason,
        dueAt: suggestion.dueAt,
      });

      const updated = await store.updateSuggestion({
        ownerUserId: input.ownerUserId,
        id: input.id,
        patch: { status: "accepted", acceptedFollowupId: followup.id },
      });
      if (!updated) {
        throw new Error("Calendar suggestion not found.");
      }

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "calendar_followup.accept",
        entityType: ENTITY_TYPE,
        entityId: updated.id,
        metadataJson: { personId: updated.personId, followupId: followup.id },
      });

      return updated;
    },

    /** Dismiss a suggestion; its dedupe key blocks normal reintroduction. */
    async dismissSuggestedFollowup(input: {
      ownerUserId: string;
      id: string;
    }): Promise<CalendarSuggestedFollowup> {
      const suggestion = await store.getSuggestion(input);
      if (!suggestion || suggestion.status !== "suggested") {
        throw new Error("Only suggested Calendar follow-ups can be dismissed.");
      }

      const updated = await store.updateSuggestion({
        ownerUserId: input.ownerUserId,
        id: input.id,
        patch: { status: "dismissed" },
      });
      if (!updated) {
        throw new Error("Calendar suggestion not found.");
      }

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "calendar_followup.dismiss",
        entityType: ENTITY_TYPE,
        entityId: updated.id,
        metadataJson: { dedupeKey: updated.dedupeKey },
      });

      return updated;
    },
  };
}
