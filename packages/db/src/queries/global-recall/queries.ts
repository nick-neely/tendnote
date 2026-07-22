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
        limitations: recallLimitations(outcomes, sources, plan),
        hasMore: merged.length > parsed.offset + results.length,
      };
    },
  };
}
