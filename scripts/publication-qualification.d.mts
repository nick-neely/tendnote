export declare const CANONICAL_ORIGIN: string;
export declare const FORMER_ORIGIN: string;
export declare const QUALIFICATION_SCHEMA_VERSION: number;
export declare const QUALIFICATION_KIND: string;
export declare const REPOSITORY: string;
export type QualificationGate = {
  id: string;
  name: string;
  criteria: readonly { id: string; name: string }[];
};
export type QualificationEvidence = {
  path?: string;
  uri?: string;
  sourceCommit: string;
  sha256: string;
  format?: string;
  description?: string;
};
export type QualificationReport = {
  candidate: { commit: string; visibility: string; immutable: true };
  result: { status: string; clean: boolean; blockers: readonly Record<string, string>[] };
  gates: readonly {
    id: string;
    name: string;
    required: true;
    status: string;
    criteria: readonly {
      id: string;
      name: string;
      status: string;
      evidence: readonly QualificationEvidence[];
      blockers: readonly Record<string, string>[];
    }[];
    evidence: readonly QualificationEvidence[];
    blockers: readonly Record<string, string>[];
  }[];
};
export declare const QUALIFICATION_GATES: readonly QualificationGate[];

export declare function composeQualificationReport(
  input?: Record<string, unknown>,
): QualificationReport;
export declare function validateQualificationReport(report: unknown): {
  valid: boolean;
  errors: string[];
};
export declare function verifyDeterministicEvidenceBundle(input: {
  root?: string;
  bundlePath?: string;
  candidateSha: string;
}): { status: string; blockers: readonly string[]; evidence: readonly QualificationEvidence[] };
export declare function verifyEvidenceFiles(input: {
  root?: string;
  candidateSha: string;
  evidence: readonly unknown[];
}): { status: string; blockers: readonly string[] };
export declare function verifyCanonicalOrigin(input?: {
  canonicalOrigin?: string;
  formerOrigin?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  status: string;
  blockers: readonly string[];
  checks?: Record<string, unknown>;
}>;
