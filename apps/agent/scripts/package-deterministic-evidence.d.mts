export type EvidenceReport = {
  startedAt?: string;
  completedAt?: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  errored?: number;
  totalEvals?: number;
  evals?: Array<{
    result?: {
      status?: string;
      events?: Array<{
        type?: string;
        data?: { runtime?: { modelId?: string; eveVersion?: string } };
      }>;
    };
  }>;
};

export type EvidenceResultRow = { id?: string; verdict?: string; status?: string };

export function buildEvidenceMetadata(input: {
  sourceCommit: string;
  workflowUrl: string;
  command: string;
  agentModel: string;
  exitCode: number;
  reports: EvidenceReport[];
  resultRows: EvidenceResultRow[][];
  junit: { tests: number; failures: number; skipped: number };
  packagedAt: string;
}): {
  sourceCommit: string;
  clean: boolean;
  counts: { passed: number; failed: number; skipped: number; errored: number; total: number };
  retry: { attempted: boolean; rounds: number };
  configuration: { agentModel: string; eveVersion: string | null; database: string };
  statuses: Record<string, number>;
};

export function observedRuntimeIdentity(
  reports: EvidenceReport[],
  expectedModel: string,
): { modelId: string; eveVersion: string | null };

export function jsonlCounts(rows: EvidenceResultRow[]): {
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  total: number;
  statuses: Record<string, number>;
};
