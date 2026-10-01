import type { AccountDeletionIntent, AccountDeletionStore } from "./types";

/**
 * The deletion store without a database. `steps` records every state change in
 * the order it happened, shared with the in-memory journal, so a test can
 * assert intent, then journal, then delete as one sequence.
 */
export function createInMemoryAccountDeletionStore(options: { steps?: string[] } = {}) {
  const steps = options.steps ?? [];
  const accounts = new Set<string>();
  const intents = new Map<string, AccountDeletionIntent>();
  const attempts = new Map<string, number>();
  let deleteFailures = 0;
  let markFailures = 0;

  const store: AccountDeletionStore = {
    async commitIntent({ userId, at }) {
      if (!accounts.has(userId)) throw new Error("No such account.");
      const existing = intents.get(userId);
      if (existing) return { ...existing };
      const intent = { userId, requestedAt: at, journaledAt: null };
      intents.set(userId, intent);
      steps.push(`intent:${userId}`);
      return { ...intent };
    },

    async findIntent({ userId }) {
      const intent = intents.get(userId);
      return intent ? { ...intent } : null;
    },

    async listIntents({ limit }) {
      const attempted = (intent: AccountDeletionIntent) => attempts.get(intent.userId) ?? -Infinity;
      return [...intents.values()]
        .sort(
          (a, b) =>
            attempted(a) - attempted(b) || a.requestedAt.getTime() - b.requestedAt.getTime(),
        )
        .slice(0, limit)
        .map((intent) => ({ ...intent }));
    },

    async markAttempted({ userId, at }) {
      if (intents.has(userId)) attempts.set(userId, at.getTime());
    },

    async markJournaled({ userId, at }) {
      if (markFailures > 0) {
        markFailures -= 1;
        throw new Error("Simulated intent update failure.");
      }
      const intent = intents.get(userId);
      if (intent) intent.journaledAt = at;
      steps.push(`journaled:${userId}`);
    },

    async deleteAccount({ userId }) {
      if (deleteFailures > 0) {
        deleteFailures -= 1;
        throw new Error("Simulated disposition failure.");
      }
      accounts.delete(userId);
      intents.delete(userId);
      attempts.delete(userId);
      steps.push(`delete:${userId}`);
    },
  };

  return {
    ...store,
    seedAccount(userId: string) {
      accounts.add(userId);
    },
    hasAccount(userId: string) {
      return accounts.has(userId);
    },
    failNextDeletes(count: number) {
      deleteFailures = count;
    },
    failNextMarks(count: number) {
      markFailures = count;
    },
  };
}
