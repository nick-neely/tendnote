import {
  curateTodayCandidates,
  type TodayCandidate,
  todayRankingOutputSchema,
} from "@tendnote/domain";
import { affectedScopesForOwnerSurfaces } from "../affected-scopes";
import type {
  TodayCandidateLoader,
  TodayFeedbackStore,
  TodayOptionalRanker,
  TodayShortlistResponse,
} from "./types";

export function createTodayShortlistService(deps: {
  feedbackStore: TodayFeedbackStore;
  loadCandidateFamilies: TodayCandidateLoader[];
  rankOptional?: TodayOptionalRanker;
}) {
  const curationByOwner = new Map<
    string,
    {
      localDate: string;
      fingerprint: string;
      optionalOrder: string[];
      curation: TodayShortlistResponse["curation"];
    }
  >();
  async function loadCandidates(input: {
    ownerUserId: string;
    localDate: string;
    timeZone: string;
    now: Date;
  }): Promise<{ candidates: TodayCandidate[]; limitations: string[] }> {
    const settled = await Promise.allSettled(deps.loadCandidateFamilies.map((load) => load(input)));
    const candidates: TodayCandidate[] = [];
    const limitations: string[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") candidates.push(...result.value);
      else limitations.push("One Today source is temporarily unavailable.");
    }
    return { candidates, limitations };
  }

  return {
    async getTodayCandidate(input: {
      ownerUserId: string;
      localDate: string;
      timeZone?: string;
      candidateIdentity: string;
      reasonKey: string;
      now?: Date;
    }): Promise<TodayCandidate | null> {
      const now = input.now ?? new Date();
      const [{ candidates }, feedback] = await Promise.all([
        loadCandidates({ ...input, timeZone: input.timeZone ?? "UTC", now }),
        deps.feedbackStore.listFeedback({ ownerUserId: input.ownerUserId }),
      ]);
      const eligible = curateTodayCandidates({
        candidates,
        feedback,
        localDate: input.localDate,
        now,
      });
      return (
        [...eligible.items, ...eligible.optionalCandidates].find(
          (candidate) =>
            candidate.identity === input.candidateIdentity &&
            candidate.reason.key === input.reasonKey,
        ) ?? null
      );
    },
    async getTodayShortlist(input: {
      ownerUserId: string;
      localDate: string;
      timeZone?: string;
      now?: Date;
      forceRefresh?: boolean;
    }): Promise<TodayShortlistResponse> {
      const now = input.now ?? new Date();
      const [{ candidates, limitations }, feedback] = await Promise.all([
        loadCandidates({ ...input, timeZone: input.timeZone ?? "UTC", now }),
        deps.feedbackStore.listFeedback({ ownerUserId: input.ownerUserId }),
      ]);
      const deterministic = curateTodayCandidates({
        candidates,
        feedback,
        localDate: input.localDate,
        now,
      });
      let curation: TodayShortlistResponse["curation"] = "deterministic";
      let optionalOrder: string[] | undefined;
      const candidateFingerprint = deterministic.candidateFingerprint;
      const prior = curationByOwner.get(input.ownerUserId);
      const canReuse =
        !input.forceRefresh &&
        prior?.localDate === input.localDate &&
        prior.fingerprint === candidateFingerprint;

      if (canReuse) {
        optionalOrder = prior.optionalOrder;
        curation = prior.curation;
        if (curation === "deterministic_fallback") {
          limitations.push("Eve ranking is unavailable; deterministic ordering used.");
        }
      } else if (deps.rankOptional && deterministic.optionalCandidates.length > 0) {
        try {
          const ranked = todayRankingOutputSchema.parse(
            await deps.rankOptional({
              ownerUserId: input.ownerUserId,
              localDate: input.localDate,
              candidates: deterministic.optionalCandidates,
            }),
          );
          optionalOrder = ranked.orderedIdentities;
          curationByOwner.set(input.ownerUserId, {
            localDate: input.localDate,
            fingerprint: candidateFingerprint,
            optionalOrder,
            curation: "eve_ranked",
          });
          curation = "eve_ranked";
        } catch {
          limitations.push("Eve ranking is unavailable; deterministic ordering used.");
          curation = "deterministic_fallback";
          curationByOwner.set(input.ownerUserId, {
            localDate: input.localDate,
            fingerprint: candidateFingerprint,
            optionalOrder: deterministic.items
              .filter((candidate) => !candidate.mandatory)
              .map((candidate) => candidate.identity),
            curation,
          });
        }
      }

      const result = curateTodayCandidates({
        candidates,
        feedback,
        localDate: input.localDate,
        now,
        optionalOrder,
      });
      return {
        items: result.items,
        candidateFingerprint,
        curation,
        overflow: result.overflow,
        limitations: [...new Set(limitations)],
      };
    },
    async suppressTodayCandidate(input: {
      ownerUserId: string;
      localDate: string;
      timeZone?: string;
      candidateIdentity: string;
      reasonKey: string;
      kind: "later" | "not_today";
      suppressUntil: Date | null;
      now?: Date;
    }) {
      const now = input.now ?? new Date();
      if (
        input.kind === "later" &&
        (input.suppressUntil === null || input.suppressUntil.getTime() <= now.getTime())
      ) {
        throw new Error("Choose a future time for Later.");
      }
      const { candidates } = await loadCandidates({
        ...input,
        timeZone: input.timeZone ?? "UTC",
        now,
      });
      const eligible = curateTodayCandidates({ candidates, now, localDate: input.localDate });
      const candidate = [...eligible.items, ...eligible.optionalCandidates].find(
        (item) => item.identity === input.candidateIdentity && item.reason.key === input.reasonKey,
      );
      if (!candidate) throw new Error("Today candidate unavailable.");

      const result = await deps.feedbackStore.saveFeedback({
        ownerUserId: input.ownerUserId,
        candidateIdentity: candidate.identity,
        reasonKey: candidate.reason.key,
        kind: input.kind,
        localDate: input.localDate,
        suppressUntil: input.kind === "later" ? input.suppressUntil : null,
      });
      return {
        result,
        affectedScopes: affectedScopesForOwnerSurfaces(input.ownerUserId),
      };
    },
  };
}
