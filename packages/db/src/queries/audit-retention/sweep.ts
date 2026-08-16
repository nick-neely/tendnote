import { getAuditLogRetentionCutoffs, isAuditLogEntryExpired } from "@tendnote/domain";
import type {
  AuditLogRetentionLogger,
  AuditLogRetentionStore,
  AuditLogRetentionSweepResult,
} from "./types";

/**
 * Deletes expired audit entries in a bounded, per-row pass. The domain supplies
 * concrete policy cutoffs to the store, which returns only candidates whose
 * deadline has passed. Expiry is evaluated again here so policy remains the
 * authority at the deletion boundary.
 */
export async function runAuditLogRetentionSweep(input: {
  limit: number;
  store: AuditLogRetentionStore;
  now?: Date;
  logger?: AuditLogRetentionLogger;
}): Promise<AuditLogRetentionSweepResult> {
  const result: AuditLogRetentionSweepResult = {
    scanned: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
  };
  if (input.limit <= 0) return result;

  const now = input.now ?? new Date();
  const candidates = await input.store.listAuditLogRetentionCandidates({
    limit: input.limit,
    cutoffs: getAuditLogRetentionCutoffs({ now }),
  });

  for (const candidate of candidates) {
    result.scanned += 1;

    if (
      !isAuditLogEntryExpired({
        action: candidate.action,
        entityType: candidate.entityType,
        createdAt: candidate.createdAt,
        now,
      })
    ) {
      result.skipped += 1;
      continue;
    }

    try {
      const deleted = await input.store.deleteAuditLogEntry({
        id: candidate.id,
        before: now,
      });
      if (!deleted) {
        result.skipped += 1;
        continue;
      }

      result.deleted += 1;
      input.logger?.info?.("audit_log_retention.deleted", {
        auditLogId: candidate.id,
        action: candidate.action,
        entityType: candidate.entityType,
      });
    } catch {
      result.failed += 1;
      input.logger?.error?.("audit_log_retention.failed", {
        auditLogId: candidate.id,
        action: candidate.action,
        entityType: candidate.entityType,
      });
    }
  }

  return result;
}
