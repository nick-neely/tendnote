import type { GlobalRecallResponse } from "@tendnote/domain";
import { RELATED_MINIMUM_SIMILARITY } from "./result-normalizers";
import type { RecallRetrievalOutcomes, RecallSearchPlan, RecallSourceResults } from "./retrieval";

type Limitation = GlobalRecallResponse["limitations"][number];

export function recallLimitations(
  outcomes: RecallRetrievalOutcomes,
  sources: RecallSourceResults,
  plan: RecallSearchPlan,
): GlobalRecallResponse["limitations"] {
  const limitations = [
    relationshipLimitation(outcomes, sources, plan),
    assetLimitation(outcomes, sources),
    savedItemLimitation(outcomes, sources, plan),
    followupLimitation(outcomes),
    calendarLimitation(outcomes, sources),
  ];
  return limitations.filter((item): item is Limitation => item !== null);
}

function relationshipLimitation(
  outcomes: RecallRetrievalOutcomes,
  sources: RecallSourceResults,
  plan: RecallSearchPlan,
): Limitation | null {
  const [exact, related] = outcomes;
  if (
    (plan.exact && exact.status === "rejected") ||
    (plan.related && related.status === "rejected")
  ) {
    return {
      source: "relationship",
      message: "Some People, relationship context, or Action results could not be confirmed.",
    };
  }
  if (sources.related.some((result) => result.similarity < RELATED_MINIMUM_SIMILARITY)) {
    return {
      source: "relationship",
      message: "Related relationship matches were too weak to show confidently.",
    };
  }
  return null;
}

function assetLimitation(
  outcomes: RecallRetrievalOutcomes,
  sources: RecallSourceResults,
): Limitation | null {
  if (outcomes[2].status === "rejected") {
    return { source: "assets", message: "Asset results are temporarily limited." };
  }
  if (!sources.assets.semanticAvailable) {
    return {
      source: "assets",
      message: "Related Asset matches are unavailable; showing confirmed exact matches only.",
    };
  }
  return null;
}

function savedItemLimitation(
  outcomes: RecallRetrievalOutcomes,
  sources: RecallSourceResults,
  plan: RecallSearchPlan,
): Limitation | null {
  const exact = outcomes[3];
  const related = outcomes[4];
  if (
    (plan.exact && exact.status === "rejected") ||
    (plan.related && related.status === "rejected")
  ) {
    return {
      source: "saved_items",
      message: "Some Saved Item results could not be confirmed.",
    };
  }
  if (sources.savedItemsRelated.some((item) => item.similarity < RELATED_MINIMUM_SIMILARITY)) {
    return {
      source: "saved_items",
      message: "Related Saved Item matches were too weak to show confidently.",
    };
  }
  return null;
}

function followupLimitation(outcomes: RecallRetrievalOutcomes): Limitation | null {
  return outcomes[5].status === "rejected"
    ? { source: "follow_ups", message: "Follow-Up results are temporarily limited." }
    : null;
}

function calendarLimitation(
  outcomes: RecallRetrievalOutcomes,
  sources: RecallSourceResults,
): Limitation | null {
  if (outcomes[6].status === "rejected") {
    return { source: "calendar", message: "Calendar results are temporarily unavailable." };
  }
  if (sources.calendar.connected && sources.calendar.result === null) {
    return {
      source: "calendar",
      message: "Connected Calendar results could not be refreshed or confirmed.",
    };
  }
  return null;
}
