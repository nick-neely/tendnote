import {
  createDrizzleOwnerDataExportArtifactStore,
  createDrizzleOwnerDataExportJobStore,
  OWNER_DATA_EXPORT_RETRY_DELAY_MS,
} from "./drizzle-store";
import { generateOwnerDataExportArchive } from "./generator";
import type {
  EnqueueOwnerDataExportJobInput,
  OwnerDataExportArtifactStore,
  OwnerDataExportJob,
  OwnerDataExportJobStore,
} from "./types";

export type OwnerDataExportRuntimeMode = "enqueue_only" | "inline";
export type OwnerDataExportProcessOutcome = "completed" | "failed" | "not_claimable";

export type EnqueueAndTriggerOwnerDataExportJobInput = EnqueueOwnerDataExportJobInput & {
  runtimeMode?: OwnerDataExportRuntimeMode;
};

export type EnqueueAndTriggerOwnerDataExportJobResult = Awaited<
  ReturnType<OwnerDataExportJobStore["enqueue"]>
> & {
  processResult: OwnerDataExportProcessResult | null;
};

export type OwnerDataExportProcessResult = {
  outcome: OwnerDataExportProcessOutcome;
  job: Awaited<ReturnType<OwnerDataExportJobStore["get"]>>;
  error?: string;
};

export function resolveOwnerDataExportRuntimeMode(input: {
  configured?: string;
  nodeEnv?: string;
}): OwnerDataExportRuntimeMode {
  if (input.configured === "inline" || input.configured === "enqueue_only") {
    return input.configured;
  }
  return input.nodeEnv === "production" ? "enqueue_only" : "inline";
}

type ProcessorDependencies = {
  jobs: OwnerDataExportJobStore;
  artifacts: OwnerDataExportArtifactStore;
  generate: typeof generateOwnerDataExportArchive;
  now?: () => Date;
};

function defaultDependencies(): ProcessorDependencies {
  return {
    jobs: createDrizzleOwnerDataExportJobStore(),
    artifacts: createDrizzleOwnerDataExportArtifactStore(),
    generate: generateOwnerDataExportArchive,
  };
}

function nowFor(deps: ProcessorDependencies) {
  return deps.now?.() ?? new Date();
}

async function notClaimableResult(
  jobs: OwnerDataExportJobStore,
  jobId: string,
  fallback: OwnerDataExportProcessResult["job"],
): Promise<OwnerDataExportProcessResult> {
  return {
    outcome: "not_claimable",
    job: (await jobs.get({ jobId })) ?? fallback,
    error: "Owner data export claim is no longer active.",
  };
}

/**
 * One explicit request generation is keyed by the latest terminal job it
 * follows. Concurrent/retried calls observe the same predecessor and collide
 * on the owner-scoped database unique index instead of creating two jobs.
 */
export function ownerDataExportRequestIdempotencyKey(
  latest: Pick<NonNullable<OwnerDataExportProcessResult["job"]>, "id"> | null,
) {
  return `owner-data-export:request-after:${latest?.id ?? "initial"}`;
}

/**
 * Process one claimed owner export. The archive is written before the job is
 * marked complete. The artifact store atomically locks and validates this
 * worker's active claim before writing, so a stale worker cannot replace the
 * bytes produced by a newer completed worker.
 */
export async function processOwnerDataExportJob(input: {
  jobId: string;
  claim?: boolean;
  claimToken?: string;
  jobs?: OwnerDataExportJobStore;
  artifacts?: OwnerDataExportArtifactStore;
  generate?: typeof generateOwnerDataExportArchive;
  now?: Date;
}): Promise<OwnerDataExportProcessResult> {
  const deps = processorDependencies(input);
  const now = nowFor(deps);
  const current = await deps.jobs.get({ jobId: input.jobId });
  if (!current) {
    return { outcome: "failed", job: null, error: "Owner data export job not found." };
  }

  const settled = settledResultFor(current);
  if (settled) return settled;

  const claim = await acquireClaim(deps, input, current, now);
  if ("result" in claim) return claim.result;

  return writeArchive(deps, claim.job, claim.claimToken, now);
}

function processorDependencies(input: {
  jobs?: OwnerDataExportJobStore;
  artifacts?: OwnerDataExportArtifactStore;
  generate?: typeof generateOwnerDataExportArchive;
  now?: Date;
}): ProcessorDependencies {
  const defaults = defaultDependencies();
  return {
    jobs: input.jobs ?? defaults.jobs,
    artifacts: input.artifacts ?? defaults.artifacts,
    generate: input.generate ?? generateOwnerDataExportArchive,
    now: () => input.now ?? new Date(),
  };
}

/** A job that already reached a terminal state is never reprocessed. */
function settledResultFor(current: OwnerDataExportJob): OwnerDataExportProcessResult | null {
  if (current.status === "completed") return { outcome: "completed", job: current };
  if (current.status === "expired") {
    return { outcome: "failed", job: current, error: "Owner data export artifact expired." };
  }
  return null;
}

/**
 * Take (or re-present) the exclusive claim this worker needs. Returns either
 * the claimed job and its token, or the result to hand straight back.
 */
async function acquireClaim(
  deps: ProcessorDependencies,
  input: { jobId: string; claim?: boolean; claimToken?: string },
  current: OwnerDataExportJob,
  now: Date,
): Promise<
  { job: OwnerDataExportJob; claimToken: string } | { result: OwnerDataExportProcessResult }
> {
  const claimed = await claimedJob(deps, input, current, now);
  if ("result" in claimed) return claimed;
  const claimToken = claimed.job.claimToken;
  if (!claimToken) {
    return { result: await notClaimableResult(deps.jobs, input.jobId, claimed.job) };
  }
  return { job: claimed.job, claimToken };
}

async function claimedJob(
  deps: ProcessorDependencies,
  input: { jobId: string; claim?: boolean; claimToken?: string },
  current: OwnerDataExportJob,
  now: Date,
): Promise<{ job: OwnerDataExportJob } | { result: OwnerDataExportProcessResult }> {
  if (input.claim === false) {
    return presentedClaim(deps, input, current);
  }
  const acquired = await deps.jobs.claim({ jobId: input.jobId, now });
  if (acquired) return { job: acquired };
  const latest = await deps.jobs.get({ jobId: input.jobId });
  if (latest?.status === "completed") return { result: { outcome: "completed", job: latest } };
  return { result: await notClaimableResult(deps.jobs, input.jobId, latest) };
}

/** `claim: false` means the caller already holds the claim and must prove it. */
async function presentedClaim(
  deps: ProcessorDependencies,
  input: { jobId: string; claimToken?: string },
  current: OwnerDataExportJob,
): Promise<{ job: OwnerDataExportJob } | { result: OwnerDataExportProcessResult }> {
  const valid =
    current.status === "running" &&
    Boolean(input.claimToken) &&
    current.claimToken === input.claimToken;
  if (valid) return { job: current };
  return { result: await notClaimableResult(deps.jobs, input.jobId, current) };
}

async function writeArchive(
  deps: ProcessorDependencies,
  claimed: OwnerDataExportJob,
  claimToken: string,
  now: Date,
): Promise<OwnerDataExportProcessResult> {
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  try {
    const archive = await deps.generate({ ownerUserId: claimed.ownerUserId, now, expiresAt });
    const artifact = await deps.artifacts.put({
      jobId: claimed.id,
      ownerUserId: claimed.ownerUserId,
      expectedClaimToken: claimToken,
      bytes: archive.bytes,
      expiresAt,
    });
    if (!artifact) return notClaimableResult(deps.jobs, claimed.id, claimed);
    const completed = await deps.jobs.markCompleted({
      jobId: claimed.id,
      expectedClaimToken: claimToken,
      artifactExpiresAt: expiresAt,
      completedAt: now,
    });
    if (!completed) return notClaimableResult(deps.jobs, claimed.id, claimed);
    return { outcome: "completed", job: completed };
  } catch (error) {
    return recordFailure(deps, claimed, claimToken, now, error);
  }
}

async function recordFailure(
  deps: ProcessorDependencies,
  claimed: OwnerDataExportJob,
  claimToken: string,
  now: Date,
  error: unknown,
): Promise<OwnerDataExportProcessResult> {
  const message = error instanceof Error ? error.message : String(error);
  const failed = await deps.jobs.markFailed({
    jobId: claimed.id,
    expectedClaimToken: claimToken,
    error: message,
    runAfter: new Date(now.getTime() + OWNER_DATA_EXPORT_RETRY_DELAY_MS),
  });
  if (!failed) return notClaimableResult(deps.jobs, claimed.id, claimed);
  return { outcome: "failed", job: failed, error: message };
}

export async function enqueueAndTriggerOwnerDataExportJob(
  input: EnqueueAndTriggerOwnerDataExportJobInput,
  overrides: Partial<ProcessorDependencies> = {},
): Promise<EnqueueAndTriggerOwnerDataExportJobResult> {
  const defaults = defaultDependencies();
  const deps: ProcessorDependencies = { ...defaults, ...overrides };
  const mode =
    input.runtimeMode ??
    resolveOwnerDataExportRuntimeMode({
      configured: process.env.TENDNOTE_OWNER_EXPORT_RUNTIME,
      nodeEnv: process.env.NODE_ENV,
    });
  const { runtimeMode: _runtimeMode, ...enqueueInput } = input;
  const result = await deps.jobs.enqueue(enqueueInput);
  if (mode === "enqueue_only") return { ...result, processResult: null };

  const processResult = await processOwnerDataExportJob({
    jobId: result.job.id,
    jobs: deps.jobs,
    artifacts: deps.artifacts,
    generate: deps.generate,
    claim: true,
  });
  return { ...result, processResult };
}

export async function claimOwnerDataExportJob(input: { jobId: string; now?: Date }) {
  return createDrizzleOwnerDataExportJobStore().claim(input);
}

export async function getOwnerDataExportJob(jobId: string) {
  return createDrizzleOwnerDataExportJobStore().get({ jobId });
}

function artifactHasLapsed(job: OwnerDataExportJob | null, now: Date): job is OwnerDataExportJob {
  return Boolean(
    job?.status === "completed" && job.artifactExpiresAt && job.artifactExpiresAt <= now,
  );
}

/**
 * Clear the cleanup cursor only after physical deletion. Any failed phase is
 * therefore retried by the bounded recovery pass rather than being forgotten.
 */
async function deleteLapsedArtifact(jobId: string, now: Date, expired: OwnerDataExportJob) {
  const jobs = createDrizzleOwnerDataExportJobStore();
  try {
    await createDrizzleOwnerDataExportArtifactStore().delete({ jobId });
    return (await jobs.markArtifactDeleted({ jobId, now })) ?? expired;
  } catch {
    return expired;
  }
}

export async function getLatestOwnerDataExportJob(ownerUserId: string) {
  const jobs = createDrizzleOwnerDataExportJobStore();
  const now = new Date();
  const latest = await jobs.getLatestForOwner({ ownerUserId });
  if (!artifactHasLapsed(latest, now)) return latest;

  const expired = await jobs.markExpired({ jobId: latest.id, now });
  if (!expired) return latest;
  return deleteLapsedArtifact(latest.id, now, expired);
}

export async function claimNextOwnerDataExportJob(input: { now?: Date }) {
  return createDrizzleOwnerDataExportJobStore().claimNext(input);
}

export async function expireOwnerDataExportArtifacts(input: {
  now?: Date;
  limit: number;
  jobs?: OwnerDataExportJobStore;
  artifacts?: OwnerDataExportArtifactStore;
}) {
  const jobs = input.jobs ?? createDrizzleOwnerDataExportJobStore();
  const artifacts = input.artifacts ?? createDrizzleOwnerDataExportArtifactStore();
  const expired = await jobs.listExpired({ now: input.now, limit: input.limit });
  let marked = 0;
  for (const job of expired) {
    if (job.status === "completed" && (await jobs.markExpired({ jobId: job.id, now: input.now }))) {
      marked += 1;
    }
    // Delete after the durable terminal transition. Because the transition
    // retains artifactExpiresAt, a failed delete remains visible next pass.
    await artifacts.delete({ jobId: job.id });
    await jobs.markArtifactDeleted({ jobId: job.id, now: input.now });
  }
  const orphanedArtifacts = await artifacts.deleteExpired({
    now: input.now,
    limit: input.limit,
  });
  return { scanned: expired.length, expired: marked, orphanedArtifacts };
}
