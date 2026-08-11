import type { AssetSearchCandidate } from "@tendnote/domain";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import type { AssetSearchAuthorityStore } from "./types";

/**
 * The proof ceiling on Asset Search.
 *
 * Until #390 this seam was the one Asset read that stopped at its SQL predicate.
 * That predicate — `visibleHouseholdRecordSql` — can see ownership, scope, active
 * membership, and the share registry, and structurally cannot see a record's
 * lifecycle, its sensitivity, or a domain's own exclusion. A row it admitted was
 * therefore *probably* the caller's to see rather than provably so, and Search is
 * exactly the surface where "probably" is worst: it is the one place a caller can
 * ask about a record they were never told exists.
 *
 * So every candidate is re-decided here, on its own stored facts, against
 * memberships read at this moment (ADR 0219). The narrowing runs before fusion,
 * because ranking an unproven row would already have let it influence the answer
 * — the relevance floor, the semantic gate, and the anchor set are all computed
 * from the candidate list, and a refused record must leave nothing behind that
 * could shift them.
 *
 * `purpose` stays `direct`: a caller typing a query has pointed at what they are
 * asking for, which is the request restricted content is reachable through. The
 * ambient surfaces — orientation, composition, proactive delivery — do not run
 * through Search.
 */
export function createAssetSearchAuthority(store: AssetSearchAuthorityStore) {
  const prover = createHouseholdAuthorizationProver(store);

  return {
    /**
     * Narrows a tier's candidates to the rows the caller may actually be answered
     * with.
     *
     * Each row is proved on its *own* facts, so a visible anchor carries nothing
     * through: the household's refrigerator being open to everyone still says
     * nothing about the private receipt hanging off it (ADR 0179). An unproven
     * candidate leaves nothing behind — no row, no citation, no gap in the result
     * count a caller could measure — because a placeholder is itself the
     * disclosure.
     */
    async keepProvenCandidates(input: {
      callerUserId: string;
      candidates: readonly AssetSearchCandidate[];
    }): Promise<AssetSearchCandidate[]> {
      if (input.candidates.length === 0) return [];

      const grants = await prover.proveVisibleRecords({
        callerUserId: input.callerUserId,
        operation: "view",
        records: input.candidates.map((candidate) => ({
          kind: candidate.recordKind,
          id: candidate.recordId,
          ownerUserId: candidate.authorization.ownerUserId,
          scope: candidate.authorization.scope,
          householdId: candidate.authorization.householdId,
          ownership: candidate.authorization.ownership,
        })),
      });

      // Keyed by kind *and* id: the three record families have independent id
      // spaces, and a grant for an Asset must never wave through a memory that
      // happened to share its id.
      const granted = new Set(grants.map((grant) => `${grant.subjectKind}:${grant.subjectId}`));
      return input.candidates.filter((candidate) =>
        granted.has(`${candidate.recordKind}:${candidate.recordId}`),
      );
    },
  };
}
