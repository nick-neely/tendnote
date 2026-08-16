import { type AuditLogRetentionCutoff, auditLogRetentionDeadlineForYears } from "@tendnote/domain";
import type { AuditLogRetentionCandidate, AuditLogRetentionStore } from "./types";

export type InMemoryAuditLogRetentionStore = AuditLogRetentionStore & {
  entries: () => AuditLogRetentionCandidate[];
  failOn: Set<string>;
};

export function createInMemoryAuditLogRetentionStore(
  initialEntries: readonly AuditLogRetentionCandidate[] = [],
): InMemoryAuditLogRetentionStore {
  const entries = initialEntries.map((entry) => ({
    ...entry,
    createdAt: new Date(entry.createdAt),
  }));
  const failOn = new Set<string>();

  const matchesCutoff = (entry: AuditLogRetentionCandidate, cutoff: AuditLogRetentionCutoff) => {
    const matchesKey =
      cutoff.action === null
        ? !cutoff.excludedKeys.some(
            (key) => key.action === entry.action && key.entityType === entry.entityType,
          )
        : cutoff.action === entry.action && cutoff.entityType === entry.entityType;

    return (
      matchesKey &&
      (cutoff.createdAtAfter === undefined ||
        entry.createdAt.getTime() >= cutoff.createdAtAfter.getTime()) &&
      entry.createdAt.getTime() <= cutoff.createdAtBefore.getTime()
    );
  };

  return {
    failOn,

    entries: () => entries.map((entry) => ({ ...entry, createdAt: new Date(entry.createdAt) })),

    async listAuditLogRetentionCandidates(input) {
      if (input.limit <= 0 || input.cutoffs.length === 0) return [];

      return input.cutoffs
        .flatMap((cutoff, partitionIndex) =>
          entries
            .filter((entry) => matchesCutoff(entry, cutoff))
            .sort(
              (left, right) =>
                left.createdAt.getTime() - right.createdAt.getTime() ||
                left.id.localeCompare(right.id),
            )
            .slice(0, input.limit)
            .map((entry) => ({
              entry,
              partitionIndex,
              deadline: auditLogRetentionDeadlineForYears({
                createdAt: entry.createdAt,
                retentionYears: cutoff.retentionYears,
              }).getTime(),
            })),
        )
        .sort(
          (left, right) =>
            left.deadline - right.deadline ||
            left.entry.createdAt.getTime() - right.entry.createdAt.getTime() ||
            left.entry.id.localeCompare(right.entry.id) ||
            left.partitionIndex - right.partitionIndex,
        )
        .slice(0, input.limit)
        .map(({ entry }) => ({ ...entry, createdAt: new Date(entry.createdAt) }));
    },

    async deleteAuditLogEntry(input) {
      if (failOn.has(input.id)) throw new Error("retention delete failed");

      const index = entries.findIndex(
        (entry) => entry.id === input.id && entry.createdAt.getTime() <= input.before.getTime(),
      );
      if (index < 0) return false;
      entries.splice(index, 1);
      return true;
    },
  };
}
