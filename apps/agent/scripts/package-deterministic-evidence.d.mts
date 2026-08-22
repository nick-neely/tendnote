export type EvidenceReport = {
  startedAt?: string;
  completedAt?: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  errored?: number;
  totalEvals?: number;
  evals?: Array<{
    id?: string;
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
  junit: { tests: number; failures: number; skipped: number; ids?: string[] };
  packagedAt: string;
}): {
  schemaVersion: 1;
  suite: "deterministic";
  sourceCommit: string;
  workflow: { trigger: "workflow_dispatch"; url: string; command: string };
  clean: boolean;
  evalIds: string[];
  counts: { passed: number; failed: number; skipped: number; errored: number; total: number };
  timestamps: { startedAt?: string; completedAt?: string; packagedAt: string };
  retry: { attempted: boolean; rounds: number };
  configuration: { agentModel: string; eveVersion: string | null; database: string };
  statuses: Record<string, number>;
  exitCode: number;
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
