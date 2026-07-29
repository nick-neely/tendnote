import { globalRecallInputSchema } from "@tendnote/domain";
import { recallCandidates } from "./candidates";
import { recallLimitations } from "./limitations";
import { matchesFamilyFilter, mergeGlobalRecallResults } from "./ranking";
import { normalizeRecallSources, planRecallSearch, retrieveRecallSources } from "./retrieval";
import type { GlobalRecall, GlobalRecallDependencies } from "./types";

export function createGlobalRecall(deps: GlobalRecallDependencies): GlobalRecall {
  return {
    async search(input) {
      const parsed = globalRecallInputSchema.parse(input);
      const plan = planRecallSearch(parsed);
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
        limitations: recallLimitations(outcomes, sources, plan, merged),
        hasMore: merged.length > parsed.offset + results.length,
      };
    },
  };
}
