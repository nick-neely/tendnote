import {
  type TemporarySuspension,
  temporarySuspensionAdmissionBlocks,
} from "@tendnote/db/queries/temporary-suspensions";
import type { AdmissionBlock } from "@tendnote/domain";
import type { TemporarySuspensionDependencies } from "./temporary-suspension";

/**
 * Suspension records in memory with the Drizzle queries' semantics: one open
 * suspension per account, a suspension keeps the first lift time it is given,
 * and the deadline in force is the newest renewal's. `steps` records each write.
 */
export function createTemporarySuspensionsFake(input: { steps?: string[] } = {}) {
  const steps = input.steps ?? [];
  const suspensions: (TemporarySuspension & { reason: string })[] = [];
  const renewals: { suspensionId: string; reviewDeadline: Date; renewedAt: Date }[] = [];

  function inForce(row: (typeof suspensions)[number] | undefined): TemporarySuspension | null {
    if (!row) return null;
    const { reason: _reason, ...suspension } = row;
    const renewal = renewals.filter((each) => each.suspensionId === row.id).at(-1);
    return renewal ? { ...suspension, reviewDeadline: renewal.reviewDeadline } : suspension;
  }
  const open = (userId: string) =>
    suspensions.find((each) => each.userId === userId && each.liftedAt === null);

  const records: TemporarySuspensionDependencies["suspensions"] = {
    findOpenSuspension: async ({ userId }) => inForce(open(userId)),
    findLatestSuspension: async ({ userId }) =>
      inForce(suspensions.filter((each) => each.userId === userId).at(-1)),
    recordSuspension: async (record) => {
      if (open(record.userId)) throw new Error("temporary_suspensions_one_open_idx");
      const row = { id: `suspension-${suspensions.length + 1}`, liftedAt: null, ...record };
      suspensions.push(row);
      steps.push("record:suspension");
      return inForce(row) as TemporarySuspension;
    },
    renewSuspensionDeadline: async (renewal) => {
      renewals.push(renewal);
      steps.push("record:renewal");
    },
    liftSuspension: async ({ id, at }) => {
      const row = suspensions.find((each) => each.id === id && each.liftedAt === null);
      if (!row) return null;
      row.liftedAt = at;
      steps.push("record:lift");
      return inForce(row);
    },
  };

  return {
    suspensions,
    renewals,
    records,
    listAdmissionBlocks: async ({ userId }: { userId: string }): Promise<AdmissionBlock[]> =>
      temporarySuspensionAdmissionBlocks(inForce(open(userId))),
  };
}
