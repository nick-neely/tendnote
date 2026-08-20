export type OwnerDataExportJobStatus = "pending" | "running" | "completed" | "failed" | "expired";

export type OwnerDataExportJob = {
  id: string;
  ownerUserId: string;
  status: OwnerDataExportJobStatus;
  attempts: number;
  lastError: string | null;
  idempotencyKey: string;
  runAfter: Date;
  claimedAt: Date | null;
  claimToken: string | null;
  completedAt: Date | null;
  artifactExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EnqueueOwnerDataExportJobInput = {
  ownerUserId: string;
  idempotencyKey?: string;
  now?: Date;
};

export type OwnerDataExportJobStore = {
  enqueue: (
    input: EnqueueOwnerDataExportJobInput,
  ) => Promise<{ job: OwnerDataExportJob; created: boolean }>;
  get: (input: { jobId: string; ownerUserId?: string }) => Promise<OwnerDataExportJob | null>;
  getLatestForOwner: (input: { ownerUserId: string }) => Promise<OwnerDataExportJob | null>;
  claim: (input: {
    jobId: string;
    now?: Date;
    leaseDurationMs?: number;
  }) => Promise<OwnerDataExportJob | null>;
  claimNext: (input: {
    now?: Date;
    leaseDurationMs?: number;
  }) => Promise<OwnerDataExportJob | null>;
  markCompleted: (input: {
    jobId: string;
    expectedClaimToken: string;
    artifactExpiresAt: Date;
    completedAt?: Date;
  }) => Promise<OwnerDataExportJob | null>;
  markFailed: (input: {
    jobId: string;
    expectedClaimToken: string;
    error: string;
    runAfter: Date;
  }) => Promise<OwnerDataExportJob | null>;
  markExpired: (input: { jobId: string; now?: Date }) => Promise<OwnerDataExportJob | null>;
  markArtifactDeleted: (input: { jobId: string; now?: Date }) => Promise<OwnerDataExportJob | null>;
  listExpired: (input: { now?: Date; limit: number }) => Promise<OwnerDataExportJob[]>;
};

export type OwnerDataExportArtifact = {
  jobId: string;
  ownerUserId: string;
  bytes: Uint8Array;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type OwnerDataExportArtifactStore = {
  put: (input: {
    jobId: string;
    ownerUserId: string;
    expectedClaimToken: string;
    bytes: Uint8Array;
    expiresAt: Date;
  }) => Promise<OwnerDataExportArtifact | null>;
  get: (input: {
    jobId: string;
    ownerUserId: string;
    now?: Date;
  }) => Promise<OwnerDataExportArtifact | null>;
  delete: (input: { jobId: string }) => Promise<void>;
  deleteExpired: (input: { now?: Date; limit: number }) => Promise<number>;
};

export type OwnerDataExportAccount = {
  id: string;
  name: string;
  email: string;
  accessStatus: "pending" | "granted" | "denied" | null;
  accessSource: string | null;
  grantedAt: Date | null;
};

export type OwnerDataExportResource = {
  path: string;
  schemaVersion: string;
  contentType: "application/json" | "text/plain" | "application/octet-stream";
  recordCount?: number;
  byteCount?: number;
  sensitivity?: "normal" | "sensitive" | "restricted";
};

export type OwnerDataExportManifest = {
  format: "tendnote-owner-data-export";
  schemaVersion: "1.0";
  generatedAt: string;
  expiresAt: string;
  accountId: string;
  resources: OwnerDataExportResource[];
  includedFamilies: string[];
  exclusions: string[];
  notes: string[];
};
