import {
  collectBirthdays,
  collectDueFollowups,
  collectRecentContext,
  collectReviewCandidates,
  mergeSemanticContext,
  requested,
  type ScoredCandidate,
} from "./collectors";
import type {
  RelationshipAgendaCandidate,
  RelationshipAgendaInput,
  RelationshipAgendaStore,
} from "./types";

const DEFAULT_LIMIT = 10;

function validWindow(input: RelationshipAgendaInput) {
  if (Number.isNaN(input.windowStart.getTime()) || Number.isNaN(input.windowEnd.getTime())) {
    throw new Error("Relationship agenda needs valid windowStart and windowEnd dates.");
  }

  if (input.windowEnd.getTime() < input.windowStart.getTime()) {
    throw new Error("Relationship agenda windowEnd must be after windowStart.");
  }
}

function dedupeSourceRefs(candidate: RelationshipAgendaCandidate) {
  const seen = new Set<string>();

  return {
    ...candidate,
    sourceRefs: candidate.sourceRefs.filter((ref) => {
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    }),
  };
}

/** Sort by score (lower is more urgent), tie-break by due date, then assign rank. */
function rank(candidates: ScoredCandidate[]) {
  return candidates
    .sort((a, b) => a.score - b.score || (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
    .map(({ score: _score, ...candidate }, index) =>
      dedupeSourceRefs({ ...candidate, rank: index + 1 }),
    );
}

/**
 * Shared owner-scoped relationship agenda read model (PRD #51/#52). Each enabled
 * candidate kind is gathered by a focused collector (see collectors.ts), then the
 * merged set is deduped and ranked. Semantic context is folded in last because it
 * merges into the candidates the other collectors already produced.
 */
export function createRelationshipAgenda(store: RelationshipAgendaStore) {
  return {
    async getRelationshipAgenda(input: RelationshipAgendaInput) {
      validWindow(input);

      const candidates: ScoredCandidate[] = [];

      if (requested(input, "due_followup")) {
        candidates.push(...(await collectDueFollowups(store, input)));
      }

      if (requested(input, "birthday")) {
        candidates.push(...(await collectBirthdays(store, input)));
      }

      if (requested(input, "review_item") || requested(input, "suggested_followup")) {
        candidates.push(...(await collectReviewCandidates(store, input)));
      }

      if (requested(input, "recent_context")) {
        candidates.push(...(await collectRecentContext(store, input)));
      }

      if (requested(input, "semantic_context") && input.query) {
        await mergeSemanticContext(store, input, candidates);
      }

      return rank(candidates).slice(0, input.limit ?? DEFAULT_LIMIT);
    },
  };
}
