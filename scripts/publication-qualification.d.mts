export declare const CANONICAL_ORIGIN: string;
export declare const FORMER_ORIGIN: string;
export declare const QUALIFICATION_SCHEMA_VERSION: number;
export declare const QUALIFICATION_KIND: string;
export declare const REPOSITORY: string;

export type QualificationStatus =
  | "passed"
  | "blocked"
  | "pending"
  | "failed"
  | "skipped"
  | "recovered"
  | "stale"
  | "not-run";

export type QualificationBinding =
  | { readonly source: "github-issue"; readonly issue: number; readonly state: string }
  | { readonly source: "github-setting"; readonly setting: string; readonly state: string };

export type QualificationGate = {
  readonly id: string;
  readonly name: string;
  readonly criteria: readonly { readonly id: string; readonly name: string }[];
};

export type QualificationEvidence = {
  readonly sourceCommit: string;
  readonly sha256: string;
  readonly format?: string;
  readonly description?: string;
} & (
  | { readonly path: string; readonly uri?: string }
  | { readonly path?: string; readonly uri: string }
);

export type QualificationBlocker = {
  readonly gateId: string;
  readonly criterionId?: string;
  readonly code: string;
  readonly message: string;
};

export type QualificationCriterion = {
  readonly id: string;
  readonly name: string;
  readonly status: QualificationStatus;
  readonly summary?: string;
  readonly binding?: QualificationBinding;
  readonly evidence: readonly QualificationEvidence[];
  readonly blockers: readonly QualificationBlocker[];
};

export type QualificationGateResult = {
  readonly id: string;
  readonly name: string;
  readonly required: true;
  readonly status: QualificationStatus;
  readonly criteria: readonly QualificationCriterion[];
  readonly evidence: readonly QualificationEvidence[];
  readonly blockers: readonly QualificationBlocker[];
};

export type QualificationBoundary = {
  readonly repositoryPublication: {
    readonly status: "pending-owner-approval" | "approved" | "not-requested";
    readonly visibilityMutationPerformed: false;
  };
  readonly externalSends: { readonly status: "none"; readonly performed: false };
};

export type QualificationReport = {
  readonly schemaVersion: 1;
  readonly kind: "tendnote.phase-9a.publication-qualification";
  readonly repository: "nick-neely/tendnote";
  readonly generatedAt: string;
  readonly candidate: {
    readonly commit: string;
    readonly visibility: "private" | "public" | "unknown";
    readonly immutable: true;
  };
  readonly result: {
    readonly status: "blocked" | "qualified";
    readonly clean: boolean;
    readonly blockers: readonly QualificationBlocker[];
  };
  readonly gates: readonly QualificationGateResult[];
  readonly boundary: QualificationBoundary;
};

export declare const QUALIFICATION_GATES: readonly QualificationGate[];
export declare const QUALIFICATION_BINDINGS: Readonly<Record<string, QualificationBinding>>;

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
}): {
  status: "passed" | "blocked";
  blockers: readonly string[];
  evidence: readonly QualificationEvidence[];
};
export declare function verifyEvidenceFiles(input: {
  root?: string;
  candidateSha: string;
  evidence: readonly QualificationEvidence[];
}): { status: "passed" | "blocked"; blockers: readonly string[] };
export declare function verifyCanonicalOrigin(input?: {
  canonicalOrigin?: string;
  formerOrigin?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  status: "passed" | "blocked";
  blockers: readonly string[];
  checks?: Record<string, unknown>;
}>;
