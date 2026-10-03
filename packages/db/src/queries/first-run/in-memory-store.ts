import type { FirstRunFacts, FirstRunStore } from "./types";

/** Test double: facts per account, with closes recorded as they land. */
export function createInMemoryFirstRunStore(initial: Record<string, Partial<FirstRunFacts>> = {}) {
  const facts = new Map<string, FirstRunFacts>(
    Object.entries(initial).map(([userId, partial]) => [
      userId,
      {
        firstRunClosed: false,
        integrationOfferClosed: false,
        hasConversation: false,
        hasPerson: false,
        firstValueReached: false,
        ...partial,
      },
    ]),
  );

  const store: FirstRunStore = {
    async readFacts({ userId }) {
      const found = facts.get(userId);
      return found ? { ...found } : null;
    },
    async hasPerson({ userId }) {
      return facts.get(userId)?.hasPerson ?? false;
    },
    async closeFirstRun({ userId }) {
      const found = facts.get(userId);
      if (found) found.firstRunClosed = true;
    },
    async closeIntegrationOffer({ userId }) {
      const found = facts.get(userId);
      if (found) found.integrationOfferClosed = true;
    },
  };

  return Object.assign(store, {
    set(userId: string, patch: Partial<FirstRunFacts>) {
      const found = facts.get(userId);
      if (found) Object.assign(found, patch);
    },
  });
}
