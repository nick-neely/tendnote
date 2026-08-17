import type { GeneralAction, SavedItem, Sensitivity, SourceRecord } from "@tendnote/domain";
import type { CalendarReaderForOwner, OwnerCalendarReadOutcome } from "../calendar";
import type { RelationshipAgendaCandidate } from "../relationship-agenda";
import { loadActionCandidates } from "./candidate-loaders/actions";
import { loadCalendarCandidates } from "./candidate-loaders/calendar";
import { loadRelationshipCandidates } from "./candidate-loaders/relationship";
import { loadAdditionalReviewCandidates } from "./candidate-loaders/reviews";
import { loadSavedItemCandidates } from "./candidate-loaders/saved-items";
import type { TodayCandidateLoader } from "./types";

type AdditionalReview = {
  id: string;
  title: string;
  createdAt: Date;
  href: string;
  sourceRefs: Array<{ kind: string; id: string }>;
  sensitivity: Sensitivity;
};

export type TodayCandidateLoaderDeps = {
  loadRelationshipAgenda: (input: {
    ownerUserId: string;
    windowStart: Date;
    windowEnd: Date;
    limit: number;
    includeKinds: Array<
      "due_followup" | "birthday" | "review_item" | "recent_context" | "suggested_followup"
    >;
  }) => Promise<RelationshipAgendaCandidate[]>;
  listActions: (input: { ownerUserId: string; limit: number }) => Promise<GeneralAction[]>;
  /**
   * The record ids this member holds their own Reminder Schedule for.
   *
   * One of the three signals that make a household-visible record personally
   * relevant. Defaults to none when a caller does not wire it, which is the
   * calm answer: a household chore nobody subscribed to nags nobody privately.
   */
  listOwnReminderRecordIds?: (input: { ownerUserId: string }) => Promise<string[]>;
  listSavedItems: (input: {
    callerUserId: string;
    includeArchived: false;
    limit: number;
  }) => Promise<SavedItem[]>;
  getSourceRecord: (input: {
    ownerUserId: string;
    sourceRecordId: string;
  }) => Promise<Pick<SourceRecord, "sensitivity"> | null>;
  readCalendar: (input: {
    ownerUserId: string;
    timeMin: Date;
    timeMax: Date;
    calendarReaderFor?: CalendarReaderForOwner;
  }) => Promise<OwnerCalendarReadOutcome>;
  listAdditionalReviews: (input: {
    ownerUserId: string;
    limit: number;
  }) => Promise<AdditionalReview[]>;
};

export function createTodayCandidateLoaders(
  deps: TodayCandidateLoaderDeps,
): TodayCandidateLoader[] {
  return [
    (input) => loadRelationshipCandidates(deps, input),
    (input) => loadActionCandidates(deps, input),
    (input) => loadSavedItemCandidates(deps, input),
    (input) => loadCalendarCandidates(deps, input),
    (input) => loadAdditionalReviewCandidates(deps, input),
  ];
}
