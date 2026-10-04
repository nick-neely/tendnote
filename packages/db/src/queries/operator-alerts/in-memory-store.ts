import type { OperatorAlertCondition } from "@tendnote/domain/operator-alerts";
import type { ClaimedOperatorAlertNotice, OperatorAlertStore } from "./types";

type Episode = {
  id: string;
  condition: OperatorAlertCondition;
  openedAt: Date;
  alertedAt: Date | null;
  clearedAt: Date | null;
  recoveredAt: Date | null;
};

/** The alert store without a database, with its episodes readable by a test. */
export function createInMemoryOperatorAlertStore() {
  const episodes: Episode[] = [];
  const openEpisode = (condition: OperatorAlertCondition) =>
    episodes.find((episode) => episode.condition === condition && !episode.clearedAt);

  const store: OperatorAlertStore = {
    async open({ condition, at }) {
      if (openEpisode(condition)) return;
      episodes.push({
        id: `episode-${episodes.length + 1}`,
        condition,
        openedAt: at,
        alertedAt: null,
        clearedAt: null,
        recoveredAt: null,
      });
    },

    async clear({ condition, at }) {
      const episode = openEpisode(condition);
      if (episode) episode.clearedAt = at;
    },

    async claimNotices({ at }) {
      const claimed: ClaimedOperatorAlertNotice[] = [];
      for (const episode of episodes) {
        if (episode.clearedAt && episode.alertedAt && !episode.recoveredAt) {
          episode.recoveredAt = at;
          claimed.push({ episodeId: episode.id, condition: episode.condition, kind: "recovery" });
        }
      }
      for (const episode of episodes) {
        if (!episode.clearedAt && !episode.alertedAt) {
          episode.alertedAt = at;
          claimed.push({ episodeId: episode.id, condition: episode.condition, kind: "alert" });
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

  return { store, episodes };
}
