export type EvidenceReport = {
  startedAt?: string;
  completedAt?: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  errored?: number;
  totalEvals?: number;
  evals?: Array<{ runtimeIdentity?: { modelId?: string; eveVersion?: string } }>;
};

export function buildEvidenceMetadata(input: {
  sourceCommit: string;
  workflowUrl: string;
  command: string;
  agentModel: string;
  exitCode: number;
  reports: EvidenceReport[];
  junit: { tests: number; failures: number; skipped: number };
  packagedAt: string;
}): {
  sourceCommit: string;
  clean: boolean;
  counts: { passed: number; failed: number; skipped: number; errored: number; total: number };
  retry: { attempted: boolean; rounds: number };
  configuration: { agentModel: string; eveVersion: string | null; database: string };
};
