import type {
  CalendarReadResult,
  GlobalRecallResponse,
  ParsedGlobalRecallInput,
} from "@tendnote/domain";
import { calendarEventMatches, followupMatches } from "./query-policy";
import {
  isResult,
  RELATED_MINIMUM_SIMILARITY,
  toAssetResult,
  toCalendarResult,
  toExactRelationshipResult,
  toExactSavedItemResult,
  toFollowupResult,
  toGiftPlanResult,
  toHouseholdContextResult,
  toRelatedRelationshipResult,
  toRelatedSavedItemResult,
  toSelfContextResult,
} from "./result-normalizers";
import type { RecallSourceResults } from "./retrieval";

export function recallCandidates(
  sources: RecallSourceResults,
  input: ParsedGlobalRecallInput,
): GlobalRecallResponse["results"] {
  return [
    ...sources.exact.map(toExactRelationshipResult).filter(isResult),
    ...sources.selfContext.map(toSelfContextResult),
    ...sources.householdContext.map(toHouseholdContextResult),
    ...sources.giftPlans.map((plan) => toGiftPlanResult(plan, input.query)),
    ...sources.related.map(toRelatedRelationshipResult).filter(isResult),
    ...sources.assets.results.map(toAssetResult),
    ...sources.savedItemsExact.map(toExactSavedItemResult),
    ...sources.savedItemsRelated
      .filter((item) => item.similarity >= RELATED_MINIMUM_SIMILARITY)
      .filter((item) => input.includeArchived || item.status === "active")
      .map(toRelatedSavedItemResult),
    ...sources.followups
      .filter((entry) => input.includeArchived || entry.followup.status !== "archived")
      .filter((entry) => followupMatches(entry, input.query))
      .map(toFollowupResult),
    ...calendarCandidates(sources.calendar.result, input.query),
  ];
}

function calendarCandidates(read: CalendarReadResult | null, query: string) {
  if (!read) return [];
  return read.events
    .filter((event) => event.status !== "cancelled")
    .filter((event) => calendarEventMatches(event, query))
    .map((event) => toCalendarResult(event, read));
}
