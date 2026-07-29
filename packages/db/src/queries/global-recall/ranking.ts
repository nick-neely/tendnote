import type { GlobalRecallFilter, GlobalRecallResult } from "@tendnote/domain";

export function matchesFamilyFilter(
  result: GlobalRecallResult,
  filter: GlobalRecallFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "people") {
    return result.family === "person" || result.family === "relationship_context";
  }
  if (filter === "follow_ups") return result.family === "follow_up";
  if (filter === "actions") return result.family === "general_action";
  if (filter === "assets") return result.family === "asset" || result.family === "asset_memory";
  if (filter === "saved_items") return result.family === "saved_item";
  return result.family === "calendar_event";
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
