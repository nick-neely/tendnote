import {
  advanceFirstValueHealth,
  emptyFirstValueHealth,
  type FirstValueAlertContext,
  type FirstValueHealthState,
  type OperatorAlertCondition,
} from "@tendnote/domain/operator-alerts";
import { applyFirstValueDecision } from "./first-value-decision";
import type { ClaimedOperatorAlertNotice, OperatorAlertStore } from "./types";

type Episode = {
  id: string;
  condition: OperatorAlertCondition;
  openedAt: Date;
  alertedAt: Date | null;
  clearedAt: Date | null;
  recoveredAt: Date | null;
  firstValueContext?: FirstValueAlertContext;
};

type MemoryState = { episodes: Episode[]; firstValue: FirstValueHealthState };

/** The alert store without a database, with its episodes readable by a test. */
export function createInMemoryOperatorAlertStore(
  state: MemoryState = { episodes: [], firstValue: emptyFirstValueHealth() },
) {
  const { episodes } = state;
  const openEpisode = (condition: OperatorAlertCondition) =>
    episodes.find((episode) => episode.condition === condition && !episode.clearedAt);

  const store: OperatorAlertStore = {
    async open({ condition, at, firstValueContext }) {
      if (openEpisode(condition)) return null;
      const id = `episode-${episodes.length + 1}`;
      episodes.push({
        id,
        condition,
        openedAt: at,
        alertedAt: null,
        clearedAt: null,
        recoveredAt: null,
        ...(firstValueContext ? { firstValueContext } : {}),
      });
      return id;
    },

    async clear({ condition, at }) {
      const episode = openEpisode(condition);
      if (episode) {
        episode.clearedAt = at;
        if (condition === "first_value_degradation") episode.recoveredAt = at;
      }
    },

    async observeFirstValue({ sample, at }) {
      const decision = advanceFirstValueHealth({
        state: state.firstValue,
        sample,
        now: at,
        incidentOpen: Boolean(openEpisode("first_value_path")),
      });
      if (decision.state === state.firstValue) return [];
      state.firstValue = decision.state;
      return applyFirstValueDecision(decision, sample.at, store);
    },

    async claimNotices({ at }) {
      const claimed: ClaimedOperatorAlertNotice[] = [];
      for (const episode of episodes) {
        if (episode.clearedAt && episode.alertedAt && !episode.recoveredAt) {
          episode.recoveredAt = at;
          claimed.push({
            episodeId: episode.id,
            condition: episode.condition,
            openedAt: episode.openedAt,
            clearedAt: episode.clearedAt,
            kind: "recovery",
            ...(episode.firstValueContext ? { firstValueContext: episode.firstValueContext } : {}),
          });
        }
      }
      for (const episode of episodes) {
        if (!episode.clearedAt && !episode.alertedAt) {
          episode.alertedAt = at;
          claimed.push({
            episodeId: episode.id,
            condition: episode.condition,
            openedAt: episode.openedAt,
            clearedAt: episode.clearedAt,
            kind: "alert",
            ...(episode.firstValueContext ? { firstValueContext: episode.firstValueContext } : {}),
          });
        }
      }
      return claimed;
    },

    async releaseNotice({ episodeId, kind }) {
      const episode = episodes.find((candidate) => candidate.id === episodeId);
      if (!episode) return;
      if (kind === "alert") episode.alertedAt = null;
      else episode.recoveredAt = null;
    },
  };

  return { store, episodes, state };
}
