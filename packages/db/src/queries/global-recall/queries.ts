import { globalRecallInputSchema } from "@tendnote/domain";
import type { UsageNotice } from "@tendnote/domain/usage-bounds";
import { recallCandidates } from "./candidates";
import { recallLimitations } from "./limitations";
import { matchesFamilyFilter, mergeGlobalRecallResults } from "./ranking";
import { normalizeRecallSources, planRecallSearch, retrieveRecallSources } from "./retrieval";
import type { GlobalRecall, GlobalRecallDependencies } from "./types";

/**
 * What search shows the owner, or normal when it cannot be read: exact and
 * Related matches both run, and the entry point still refuses an embedding past
 * the ceiling, which the Related tiers already absorb.
 */
async function readSearchUsage(
  deps: GlobalRecallDependencies,
  ownerUserId: string,
): Promise<UsageNotice> {
  try {
    return (await deps.readSearchUsage?.(ownerUserId)) ?? { state: "normal" };
  } catch {
    console.warn("usage: could not read search usage, so search runs as usual");
    return { state: "normal" };
  }
}

export function createGlobalRecall(deps: GlobalRecallDependencies): GlobalRecall {
  return {
    async search(input) {
      const parsed = globalRecallInputSchema.parse(input);
      const usage = await readSearchUsage(deps, input.ownerUserId);
      // Reduced search is exact search: Related matches cost a query embedding,
      // which is charged to the background allowance the account has used up.
      const plan = {
        ...planRecallSearch(parsed),
        ...(usage.state === "normal" ? {} : { related: false }),
      };
      const outcomes = await retrieveRecallSources(deps, input.ownerUserId, parsed, plan);
      const sources = normalizeRecallSources(outcomes, plan);
      const candidates = recallCandidates(sources, parsed);
      const merged = mergeGlobalRecallResults(
        candidates
          .filter((result) => matchesFamilyFilter(result, parsed.family))
          .filter((result) => !parsed.matchKinds || parsed.matchKinds.includes(result.match.kind)),
      );
      const results = merged.slice(parsed.offset, parsed.offset + parsed.limit);

      return {
        query: parsed.query,
        results,
        // Limitations read the full merged match list, not the page: a Related
        // candidate withheld behind a page of answers is not a gap the owner is
        // looking at, while an empty search is.
        limitations: recallLimitations(outcomes, sources, plan, merged, parsed.family, usage),
        hasMore: merged.length > parsed.offset + results.length,
      };
    },
  };
}
