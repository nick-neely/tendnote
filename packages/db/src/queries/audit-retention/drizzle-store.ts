import { type AuditLogRetentionCutoff, auditLogRetentionDeadlineForYears } from "@tendnote/domain";
import { and, asc, eq, gte, inArray, lte, not, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../client";
import { getDb } from "../../client";
import { auditLog } from "../../schema";
import type { AuditLogRetentionStore } from "./types";

function createdAtPredicate(cutoff: AuditLogRetentionCutoff) {
  if (cutoff.createdAtAfter === undefined) {
    return lte(auditLog.createdAt, cutoff.createdAtBefore);
  }

  return and(
    gte(auditLog.createdAt, cutoff.createdAtAfter),
    lte(auditLog.createdAt, cutoff.createdAtBefore),
  );
}

function cutoffPredicate(cutoff: AuditLogRetentionCutoff) {
  const createdAt = createdAtPredicate(cutoff);

  if (cutoff.action !== null && cutoff.entityType !== null) {
    return and(
      createdAt,
      eq(auditLog.action, cutoff.action),
      eq(auditLog.entityType, cutoff.entityType),
    );
  }

  if (cutoff.excludedKeys.length === 0) return createdAt;

  const excluded = sql.join(
    cutoff.excludedKeys.map(
      (key) =>
        sql`(${eq(auditLog.action, key.action)} and ${eq(auditLog.entityType, key.entityType)})`,
    ),
    sql` or `,
  );

  return and(createdAt, not(sql`(${excluded})`));
}

export function createDrizzleAuditLogRetentionStore(
  resolveDb: () => DatabaseExecutor = getDb,
  options: { candidateIds?: readonly string[] } = {},
): AuditLogRetentionStore {
  return {
    async listAuditLogRetentionCandidates(input) {
      if (input.limit <= 0 || input.cutoffs.length === 0) return [];

      const db = resolveDb();
      // Each fixed policy partition is capped at the pass limit. The merged
      // result is capped again below, so row processing and deletion remain
      // bounded even when policies are mixed.
      const partitionRows = await Promise.all(
        input.cutoffs.map(async (cutoff, partitionIndex) => ({
          cutoff,
          partitionIndex,
          rows: await db
            .select({
              id: auditLog.id,
              action: auditLog.action,
              entityType: auditLog.entityType,
              createdAt: auditLog.createdAt,
            })
            .from(auditLog)
            .where(
              options.candidateIds === undefined
                ? cutoffPredicate(cutoff)
                : and(cutoffPredicate(cutoff), inArray(auditLog.id, options.candidateIds)),
            )
            .orderBy(asc(auditLog.createdAt), asc(auditLog.id))
            .limit(input.limit),
        })),
      );

      return partitionRows
        .flatMap(({ cutoff, partitionIndex, rows }) =>
          rows.map((candidate) => ({
            candidate,
            partitionIndex,
            deadline: auditLogRetentionDeadlineForYears({
              createdAt: candidate.createdAt,
              retentionYears: cutoff.retentionYears,
            }).getTime(),
          })),
        )
        .sort(
          (left, right) =>
            left.deadline - right.deadline ||
            left.candidate.createdAt.getTime() - right.candidate.createdAt.getTime() ||
            left.candidate.id.localeCompare(right.candidate.id) ||
            left.partitionIndex - right.partitionIndex,
        )
        .slice(0, input.limit)
        .map(({ candidate }) => candidate);
    },

    async deleteAuditLogEntry(input) {
      const rows = await resolveDb()
        .delete(auditLog)
        .where(and(eq(auditLog.id, input.id), lte(auditLog.createdAt, input.before)))
        .returning({ id: auditLog.id });
      return rows.length > 0;
    },
  };
}
