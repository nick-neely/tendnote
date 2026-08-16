import type { AuditLogRetentionCutoff, AuditLogRetentionKey } from "@tendnote/domain";

export type AuditLogRetentionCandidate = AuditLogRetentionKey & {
  id: string;
  createdAt: Date;
};

export type AuditLogRetentionStore = {
  /**
   * Queries each concrete policy/range partition through the created-at index,
   * then returns a deterministic earliest-expiring merge capped at the pass
   * budget.
   */
  listAuditLogRetentionCandidates: (input: {
    limit: number;
    cutoffs: readonly AuditLogRetentionCutoff[];
  }) => Promise<AuditLogRetentionCandidate[]>;
  /** Deletes only the identified row when it is still at or before `before`. */
  deleteAuditLogEntry: (input: { id: string; before: Date }) => Promise<boolean>;
};

export type AuditLogRetentionLogger = {
  info?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
};

export type AuditLogRetentionSweepResult = {
  scanned: number;
  deleted: number;
  skipped: number;
  failed: number;
};
