import { createDefaultGoogleCalendarReader } from "./calendar";
import {
  createDrizzleCalendarPeopleMatcher,
  createDrizzleCalendarSuggestionStore,
} from "./calendar-followups/drizzle-store";
import { createCalendarSuggestionReview } from "./calendar-followups/suggestions";
import type {
  CalendarPeopleMatcher,
  CalendarSuggestionClassifier,
} from "./calendar-followups/types";
import { createCalendarSuggestionWorkflow } from "./calendar-followups/workflow";
import { createFollowup } from "./followups";

export {
  createDrizzleCalendarPeopleMatcher,
  createDrizzleCalendarSuggestionStore,
} from "./calendar-followups/drizzle-store";
export { createInMemoryCalendarSuggestionStore } from "./calendar-followups/in-memory-store";
export { matchAttendee } from "./calendar-followups/matching";
export { generateCalendarSuggestionCandidates } from "./calendar-followups/pipeline";
export { createCalendarSuggestionReview } from "./calendar-followups/suggestions";
export type * from "./calendar-followups/types";
export type * from "./calendar-followups/workflow";
export { createCalendarSuggestionWorkflow } from "./calendar-followups/workflow";

import type { CalendarEventSummary, CalendarSuggestedFollowup } from "@tendnote/domain";

const defaultReview = createCalendarSuggestionReview(createDrizzleCalendarSuggestionStore());
const defaultMatcher = createDrizzleCalendarPeopleMatcher();
const defaultWorkflow = createCalendarSuggestionWorkflow({
  readerFor: () => createDefaultGoogleCalendarReader(),
  review: defaultReview,
  matcher: defaultMatcher,
});

/** Generate + persist fresh Calendar suggested follow-ups for an owner. */
export async function generateCalendarSuggestions(
  input: { ownerUserId: string; events: readonly CalendarEventSummary[]; now?: Date },
  deps: { matcher?: CalendarPeopleMatcher; classify?: CalendarSuggestionClassifier } = {},
): Promise<CalendarSuggestedFollowup[]> {
  return defaultReview.generateSuggestions(input, {
    matcher: deps.matcher ?? defaultMatcher,
    classify: deps.classify,
  });
}

export async function listCalendarSuggestedFollowups(ownerUserId: string) {
  return defaultReview.listSuggestedFollowups(ownerUserId);
}

/** Accept a Calendar suggestion, promoting it into the active follow-up lifecycle. */
export async function acceptCalendarSuggestedFollowup(input: { ownerUserId: string; id: string }) {
  return defaultReview.acceptSuggestedFollowup(input, {
    createActiveFollowup: (followup) => createFollowup(followup),
  });
}

export async function dismissCalendarSuggestedFollowup(input: { ownerUserId: string; id: string }) {
  return defaultReview.dismissSuggestedFollowup(input);
}

/** Run the bounded production workflow that populates Calendar prompt nudges. */
export async function runCalendarSuggestionWorkflow(input: { ownerUserId: string; now?: Date }) {
  return defaultWorkflow.runCalendarSuggestionWorkflow(input);
}
