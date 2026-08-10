import type { GlobalRecallFamily, GlobalRecallFilter, GlobalRecallResult } from "@tendnote/domain";

/**
 * Which record families each narrowing control actually names.
 *
 * A table rather than the if-chain this used to be. The chain ended in a bare
 * `return result.family === "self_context"`, which was only correct while
 * Self Context was the last filter in the enum: adding Household Context beside
 * it would have made a Household-only search answer with the member's private
 * statements about themselves, conflating the two subjects the household domain
 * exists to keep apart. A `Record` keyed on the filter enum turns the next
 * family added into a compile error instead of a silent mis-filter.
 */
const FAMILIES_BY_FILTER: Record<
  Exclude<GlobalRecallFilter, "all">,
  readonly GlobalRecallFamily[]
> = {
  people: ["person", "relationship_context"],
  follow_ups: ["follow_up"],
  actions: ["general_action"],
  assets: ["asset", "asset_memory"],
  saved_items: ["saved_item"],
  calendar: ["calendar_event"],
  self_context: ["self_context"],
  household_context: ["household_context"],
};

export function matchesFamilyFilter(
  result: GlobalRecallResult,
  filter: GlobalRecallFilter,
): boolean {
  return filter === "all" || FAMILIES_BY_FILTER[filter].includes(result.family);
}

export function mergeGlobalRecallResults(results: GlobalRecallResult[]): GlobalRecallResult[] {
  const sorted = [
    ...results.filter((result) => result.match.kind === "exact"),
    ...results.filter((result) => result.match.kind === "related"),
  ];
  const seen = new Set<string>();
  const deduplicated = sorted.filter((result) => {
    const key = canonicalKey(result);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [
    ...diversifyBand(deduplicated.filter((result) => result.match.kind === "exact")),
    ...diversifyBand(deduplicated.filter((result) => result.match.kind === "related")),
  ];
}

function diversifyBand(results: GlobalRecallResult[]): GlobalRecallResult[] {
  const preferred: GlobalRecallResult[] = [];
  const overflow: GlobalRecallResult[] = [];
  const contextCounts = new Map<string, number>();
  for (const result of results) {
    const key = result.parent ? `${result.parent.kind}:${result.parent.id}` : canonicalKey(result);
    const count = contextCounts.get(key) ?? 0;
    if (count < 2) {
      preferred.push(result);
      contextCounts.set(key, count + 1);
    } else {
      overflow.push(result);
    }
  }
  return [...preferred, ...overflow];
}

export function canonicalKey(result: GlobalRecallResult): string {
  return `${result.canonical.kind}:${result.canonical.id}`;
}
