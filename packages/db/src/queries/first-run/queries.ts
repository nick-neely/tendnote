import type { FirstRunStore } from "./types";

/** What Home owes this account on this request. */
export type HomeFirstRun = {
  /** The one first-run prompt, owed until it is answered or skipped. */
  welcome: boolean;
  /**
   * Nobody saved yet: the only state in which a skipped prompt is repeated, so
   * every surface that repeats it answers the same question.
   */
  notebookEmpty: boolean;
  /** The integrations offer, owed only after First Value until it is closed. */
  integrationOffer: boolean;
};

export const NOTHING_OWED: HomeFirstRun = {
  welcome: false,
  notebookEmpty: false,
  integrationOffer: false,
};

export function createFirstRunQueries(store: FirstRunStore) {
  return {
    /**
     * The prompt is answered by doing what it asks: a first conversation with
     * Eve, from any surface, or a first person saved any other way. Neither
     * needs a write of its own, so no surface can forget to record it. Skipping
     * is the only thing that closes it explicitly.
     *
     * Integrations are offered only once First Value is reached (#565), and the
     * milestone is the source of truth for that, never a count of records.
     */
    async getHomeFirstRun(input: { userId: string }): Promise<HomeFirstRun> {
      const facts = await store.readFacts(input);
      if (!facts) return NOTHING_OWED;
      return {
        welcome: !facts.firstRunClosed && !facts.hasConversation && !facts.hasPerson,
        notebookEmpty: !facts.hasPerson,
        integrationOffer: facts.firstValueReached && !facts.integrationOfferClosed,
      };
    },

    /** Whether the owner has saved anyone yet, for Eve's first-capture steer. */
    async hasSavedAPerson(input: { userId: string }): Promise<boolean> {
      return store.hasPerson(input);
    },

    /** Skip the first-run prompt. Idempotent: the first close is the one kept. */
    async closeFirstRun(input: { userId: string }) {
      await store.closeFirstRun({ userId: input.userId, at: new Date() });
    },

    /** Answer or set aside the integrations offer. Idempotent like the first run. */
    async closeIntegrationOffer(input: { userId: string }) {
      await store.closeIntegrationOffer({ userId: input.userId, at: new Date() });
    },
  };
}
