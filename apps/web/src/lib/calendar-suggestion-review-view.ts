import type { CalendarSuggestedFollowup } from "@tendnote/domain";
import { type FollowupDueState, followupDueState, toDateInputValue } from "./followup-view";

export type CalendarSuggestionReviewView = {
  id: string;
  personId: string | null;
  personName: string | null;
  unresolvedAttendee: string | null;
  matchKind: CalendarSuggestedFollowup["matchKind"];
  tentative: boolean;
  reason: string;
  dueAtISO: string;
  dueAtDate: string;
  dueLabel: string;
  dueState: FollowupDueState;
};

/**
 * Calendar-derived suggestions are provider context, not approved memory or active
 * follow-ups. This view keeps that distinction explicit while giving the web rail
 * enough shape to accept resolved suggestions or dismiss any suggestion.
 */
export function toCalendarSuggestionReviewView(
  suggestion: CalendarSuggestedFollowup,
  now: Date = new Date(),
): CalendarSuggestionReviewView {
  return {
    id: suggestion.id,
    personId: suggestion.personId,
    personName: suggestion.personDisplayName,
    unresolvedAttendee: suggestion.unresolvedAttendee,
    matchKind: suggestion.matchKind,
    tentative: suggestion.tentative,
    reason: suggestion.reason,
    dueAtISO: suggestion.dueAt.toISOString(),
    dueAtDate: toDateInputValue(suggestion.dueAt),
    dueLabel: suggestion.dueAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: suggestion.dueAt.getFullYear() === now.getFullYear() ? undefined : "numeric",
    }),
    dueState: followupDueState(suggestion.dueAt, now),
  };
}
