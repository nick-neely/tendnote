import {
  curateTodayCandidates,
  type TodayCandidate,
  todayRankingOutputSchema,
} from "@tendnote/domain";
import { affectedScopesForOwnerSurfaces } from "../affected-scopes";
import type { CalendarReaderForOwner } from "../calendar";
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
    calendarReaderFor?: CalendarReaderForOwner;
  }): Promise<{ candidates: TodayCandidate[]; limitations: string[] }> {
    const settled = await Promise.allSettled(deps.loadCandidateFamilies.map((load) => load(input)));
    const candidates: TodayCandidate[] = [];
    const limitations: string[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") candidates.push(...result.value);
      // The owner is told only what changes what they see: part of Today is
      // missing, and nothing of theirs moved. Which internal source failed is a
      // log line, not copy (DESIGN.md §9).
      else
        limitations.push("Part of Today is temporarily unavailable. Your records are unchanged.");
    }
    return { candidates, limitations };
  }

  function isAbortLikeError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const candidate = error as { code?: unknown; name?: unknown };
    return (
      candidate.name === "AbortError" ||
      candidate.name === "TimeoutError" ||
      candidate.code === "ABORT_ERR"
    );
  }

  /**
   * Eve's optional ranking is a nicety over an already-complete deterministic
   * list: when it is unavailable the owner sees the same items in a sensible
   * order, so there is nothing to tell them. The fallback is recorded in
   * `curation` for logs and tests, and only unexpected development failures
   * receive a concise warning. It never becomes a limitation the UI renders.
   */
  function noteRankingFallback(error: unknown): void {
    if (process.env.NODE_ENV === "production" || isAbortLikeError(error)) return;
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("Eve ranking is unavailable; using deterministic Today ordering.", reason);
  }

  return {
    async getTodayCandidate(input: {
      ownerUserId: string;
      localDate: string;
      timeZone?: string;
      calendarReaderFor?: CalendarReaderForOwner;
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
      calendarReaderFor?: CalendarReaderForOwner;
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
        } catch (error) {
          noteRankingFallback(error);
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
    async restoreTodayCandidate(input: {
      ownerUserId: string;
      localDate: string;
      candidateIdentity: string;
      reasonKey: string;
      kind: "later" | "not_today";
    }) {
      const result = await deps.feedbackStore.deleteFeedback(input);
      return {
        result,
        affectedScopes: affectedScopesForOwnerSurfaces(input.ownerUserId),
      };
    },
  };
}
