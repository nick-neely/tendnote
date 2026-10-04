import { type Termination, terminationAdmissionBlocks } from "@tendnote/db/queries/terminations";
import type { AdmissionBlock } from "@tendnote/domain";
import type { TerminationDependencies } from "./termination";

/**
 * Termination records in memory with the Drizzle queries' semantics: at most
 * one per account, and nothing about it changes but the subscription stored on
 * it afterwards. `steps` records each write.
 */
export function createTerminationsFake(input: { steps?: string[] } = {}) {
  const steps = input.steps ?? [];
  const terminations: (Termination & { reason: string })[] = [];

  const find = (userId: string) => terminations.find((each) => each.userId === userId);
  const withoutReason = (row: (typeof terminations)[number]): Termination => {
    const { reason: _reason, ...termination } = row;
    return termination;
  };

  const records: TerminationDependencies["terminations"] = {
    findTermination: async ({ userId }) => {
      const row = find(userId);
      return row ? withoutReason(row) : null;
    },
    recordTermination: async (record) => {
      if (find(record.userId)) throw new Error("terminations_user_id_unique");
      const row = {
        id: `termination-${terminations.length + 1}`,
        stripeSubscriptionId: null,
        ...record,
      };
      terminations.push(row);
      steps.push("record:termination");
      return withoutReason(row);
    },
    attachTerminationSubscription: async ({ id, stripeSubscriptionId }) => {
      const row = terminations.find((each) => each.id === id);
      if (row) row.stripeSubscriptionId = stripeSubscriptionId;
      steps.push("record:termination-subscription");
    },
  };

  return {
    terminations,
    records,
    isTerminated: async ({ userId }: { userId: string }) => find(userId) !== undefined,
    listAdmissionBlocks: async ({ userId }: { userId: string }): Promise<AdmissionBlock[]> => {
      const row = find(userId);
      return terminationAdmissionBlocks(row ? withoutReason(row) : null);
    },
  };
}
