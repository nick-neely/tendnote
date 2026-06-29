import {
  CALENDAR_SUGGESTION_MAX_PER_RUN,
  CALENDAR_SUGGESTION_REASON_MAX,
  type CalendarEventSummary,
  calendarSuggestionDedupeKey,
} from "@tendnote/domain";
import { matchAttendee } from "./matching";
import type {
  CalendarPeopleMatcher,
  CalendarSuggestionCandidate,
  CalendarSuggestionClassifier,
} from "./types";

const SHAPE = "post_meeting_followup" as const;
/** Only meetings that ended within this lookback are post-meeting candidates. */
const DEFAULT_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
/** Gentle default due date for an accepted nudge: a day out. */
const DEFAULT_DUE_OFFSET_MS = 24 * 60 * 60 * 1000;

function truncateReason(reason: string): string {
  const trimmed = reason.trim();
  return trimmed.length <= CALENDAR_SUGGESTION_REASON_MAX
    ? trimmed
    : `${trimmed.slice(0, CALENDAR_SUGGESTION_REASON_MAX - 1).trimEnd()}…`;
}

/**
 * Deterministic-first candidate generation (ADR-0082). Bounds candidate events by
 * connected-calendar status, a recent-meeting time window, confirmed status, and a
 * matchable non-self attendee; matches attendees to existing people (never creating
 * any); dedupes by the stable key; and caps the run. An optional LLM classifier may
 * refine the reason over a bounded minimized summary, but cannot widen scope, bypass
 * caps, or create anything.
 */
export async function generateCalendarSuggestionCandidates(
  input: { ownerUserId: string; events: readonly CalendarEventSummary[]; now: Date },
  deps: {
    matcher: CalendarPeopleMatcher;
    classify?: CalendarSuggestionClassifier;
    lookbackMs?: number;
    maxPerRun?: number;
    /** Dedupe keys to skip (already-suggested/accepted/dismissed) BEFORE the cap, so
        stale keys never crowd out fresh suggestions. */
    excludeKeys?: ReadonlySet<string>;
  },
): Promise<CalendarSuggestionCandidate[]> {
  const lookbackMs = deps.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const maxPerRun = deps.maxPerRun ?? CALENDAR_SUGGESTION_MAX_PER_RUN;
  const nowMs = input.now.getTime();
  const dueAt = new Date(nowMs + DEFAULT_DUE_OFFSET_MS);

  const candidates: CalendarSuggestionCandidate[] = [];
  // Pre-seed with excluded keys so they are skipped without counting toward the cap.
  const seen = new Set<string>(deps.excludeKeys ?? []);

  for (const event of input.events) {
    // Recent, ended, confirmed, timed meetings only (post-meeting follow-ups).
    // All-day events are not meetings to follow up on.
    if (event.status !== "confirmed" || event.allDay) {
      continue;
    }
    const endedMs = event.end.getTime();
    if (endedMs > nowMs || nowMs - endedMs > lookbackMs) {
      continue;
    }

    const others = event.attendees.filter((attendee) => !attendee.self);
    if (others.length === 0) {
      continue;
    }

    for (const attendee of others) {
      const match = await matchAttendee(input.ownerUserId, attendee, deps.matcher);
      const dedupeKey = calendarSuggestionDedupeKey({
        providerEventId: event.providerEventId,
        calendarId: event.calendarId,
        personId: match.personId,
        unresolvedAttendee: match.unresolvedAttendee,
        shape: SHAPE,
      });
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      const title = event.title?.trim() ? event.title : "your recent meeting";
      const who = match.personDisplayName ?? match.unresolvedAttendee;
      const deterministicReason = who
        ? `Follow up after ${title} with ${who}`
        : `Follow up after ${title}`;

      // The classifier sees only a bounded minimized summary (ADR-0082).
      const classified = deps.classify
        ? await deps
            .classify({
              title,
              startsAt: event.start.toISOString(),
              withWhom: who,
            })
            .catch(() => null)
        : null;

      candidates.push({
        ...match,
        providerEventId: event.providerEventId,
        calendarId: event.calendarId,
        shape: SHAPE,
        reason: truncateReason(classified?.trim() ? classified : deterministicReason),
        dueAt,
        dedupeKey,
      });

      if (candidates.length >= maxPerRun) {
        return candidates;
      }
    }
  }

  return candidates;
}
