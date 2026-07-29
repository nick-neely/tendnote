import type { GlobalRecallResponse, GlobalRecallResult } from "@tendnote/domain";
import { canonicalKey } from "./ranking";
import {
  RELATED_MINIMUM_SIMILARITY,
  relatedRelationshipCandidate,
  toRelatedSavedItemResult,
} from "./result-normalizers";
import type { RecallRetrievalOutcomes, RecallSearchPlan, RecallSourceResults } from "./retrieval";

type Limitation = GlobalRecallResponse["limitations"][number];

/**
 * Semantic retrieval is asked for `minimumSimilarity: 0`, so nearly every search
 * comes back holding at least one candidate under `RELATED_MINIMUM_SIMILARITY`.
 * Reporting "a Related match was withheld" on that alone made the note permanent
 * on ordinary successful searches, which is exactly the standing diagnostic the
 * calm register rejects (apps/web/DESIGN.md section 9).
 *
 * Similarity is a continuum rather than two clean bands, so the floor below is a
 * judgement line drawn from what the dev database actually returns. Queries with
 * no bearing on any stored record stay low: "prefers email" 0.12, "vacation
 * plans" 0.18, the nonsense "qwzxjkl bloop" 0.19, "dana" 0.20, "coffee" 0.21.
 * Queries reaching for a record in the record's own subject climb steadily
 * against the same Action, shown at 0.58 for "smoke alarm": "recurring chore"
 * 0.36, "clean the house" 0.47, "cleaning task" 0.51, "household chore reminder"
 * 0.53. A 0.45 line keeps the note off every unrelated query observed while still
 * covering wording that was plainly aiming at the record.
 */
const RELATED_NEAR_MISS_SIMILARITY = 0.45;

/**
 * A withheld Related candidate is only worth a note when the owner would
 * otherwise wonder where a record went:
 *
 * - the search rendered nothing, so the withheld candidate is the only account
 *   we can give of what the search actually reached, or
 * - the closest withheld candidate was a near miss the owner never saw, so it
 *   plausibly belonged in the list they are reading.
 *
 * Noise withheld alongside a list of real answers is not a limitation the owner
 * needs, so it stays silent. At most one note is emitted, attributed to the
 * family holding the closest withheld candidate, so the footer stays one quiet
 * line rather than one line per family.
 */
export function recallLimitations(
  outcomes: RecallRetrievalOutcomes,
  sources: RecallSourceResults,
  plan: RecallSearchPlan,
  matches: GlobalRecallResponse["results"],
): GlobalRecallResponse["limitations"] {
  const reported = [
    relationshipLimitation(outcomes, plan),
    assetLimitation(outcomes, sources),
    savedItemLimitation(outcomes, plan),
    followupLimitation(outcomes),
    calendarLimitation(outcomes, sources),
  ].filter((item): item is Limitation => item !== null);
  const withheld = withheldRelatedLimitation(sources, matches);
  // A family that already reported a retrieval failure has no surviving Related
  // candidates to withhold, but the response must never carry one source twice.
  return withheld && !reported.some((item) => item.source === withheld.source)
    ? [...reported, withheld]
    : reported;
}

function withheldRelatedLimitation(
  sources: RecallSourceResults,
  matches: GlobalRecallResponse["results"],
): Limitation | null {
  const closest = closestWithheld(sources, new Set(matches.map(canonicalKey)));
  if (!closest) return null;
  if (matches.length === 0) {
    // The surfaces already say nothing matched. The only thing left to add is
    // that the search did reach records, just none close enough to stand behind.
    return {
      source: closest.source,
      message: "The nearest records were only loosely related to that search.",
    };
  }
  if (closest.similarity < RELATED_NEAR_MISS_SIMILARITY) return null;
  return {
    source: closest.source,
    message:
      closest.source === "relationship"
        ? "Some People and context matches were close, but not close enough to show."
        : "Some Saved Item matches were close, but not close enough to show.",
  };
}

type WithheldCandidate = {
  source: "relationship" | "saved_items";
  similarity: number;
  key: string | null;
};

/**
 * The closest candidate the similarity floor actually cost the owner. A candidate
 * whose canonical record the Exact pass already put on screen cost nothing, and a
 * query worded close to a record's own text routinely produces exactly that: the
 * dev database answers "reminder" and "clean" with the Action itself while the
 * same Action trails a 0.43 semantic candidate behind it.
 */
function closestWithheld(
  sources: RecallSourceResults,
  shown: Set<string>,
): WithheldCandidate | null {
  const withheld: WithheldCandidate[] = [
    ...sources.related
      .filter((result) => result.similarity < RELATED_MINIMUM_SIMILARITY)
      .map((result) => ({
        source: "relationship" as const,
        similarity: result.similarity,
        key: keyOf(relatedRelationshipCandidate(result)),
      })),
    ...sources.savedItemsRelated
      .filter((item) => item.similarity < RELATED_MINIMUM_SIMILARITY)
      .map((item) => ({
        source: "saved_items" as const,
        similarity: item.similarity,
        key: keyOf(toRelatedSavedItemResult(item)),
      })),
  ].filter((candidate) => !candidate.key || !shown.has(candidate.key));
  return withheld.reduce<WithheldCandidate | null>(
    (best, candidate) => (best && best.similarity >= candidate.similarity ? best : candidate),
    null,
  );
}

function keyOf(result: GlobalRecallResult | null): string | null {
  return result ? canonicalKey(result) : null;
}

function relationshipLimitation(
  outcomes: RecallRetrievalOutcomes,
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
