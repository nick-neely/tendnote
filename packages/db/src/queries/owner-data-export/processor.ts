import {
  createDrizzleOwnerDataExportArtifactStore,
  createDrizzleOwnerDataExportJobStore,
  OWNER_DATA_EXPORT_RETRY_DELAY_MS,
} from "./drizzle-store";
import { generateOwnerDataExportArchive } from "./generator";
import type {
  EnqueueOwnerDataExportJobInput,
  OwnerDataExportArtifactStore,
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
  const deps: ProcessorDependencies = {
    jobs: input.jobs ?? defaultDependencies().jobs,
    artifacts: input.artifacts ?? defaultDependencies().artifacts,
    generate: input.generate ?? generateOwnerDataExportArchive,
    now: () => input.now ?? new Date(),
  };
  const now = nowFor(deps);
  const current = await deps.jobs.get({ jobId: input.jobId });
  if (!current) {
    return { outcome: "failed", job: null, error: "Owner data export job not found." };
  }

  if (current.status === "completed") return { outcome: "completed", job: current };
  if (current.status === "expired") {
    return { outcome: "failed", job: current, error: "Owner data export artifact expired." };
  }

  let claimed = current;
  if (input.claim !== false) {
    const acquired = await deps.jobs.claim({ jobId: input.jobId, now });
    if (!acquired) {
      const latest = await deps.jobs.get({ jobId: input.jobId });
      if (latest?.status === "completed") return { outcome: "completed", job: latest };
      return notClaimableResult(deps.jobs, input.jobId, latest);
    }
    claimed = acquired;
  } else if (
    current.status !== "running" ||
    !input.claimToken ||
    current.claimToken !== input.claimToken
  ) {
    return notClaimableResult(deps.jobs, input.jobId, current);
  }

  const claimToken = claimed.claimToken;
  if (!claimToken) return notClaimableResult(deps.jobs, input.jobId, claimed);

  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  try {
    const archive = await deps.generate({
      ownerUserId: claimed.ownerUserId,
      now,
      expiresAt,
    });
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

export async function getLatestOwnerDataExportJob(ownerUserId: string) {
  const jobs = createDrizzleOwnerDataExportJobStore();
  const artifacts = createDrizzleOwnerDataExportArtifactStore();
  const now = new Date();
  const latest = await jobs.getLatestForOwner({ ownerUserId });
  if (
    latest?.status === "completed" &&
    latest.artifactExpiresAt &&
    latest.artifactExpiresAt <= now
  ) {
    const expired = await jobs.markExpired({ jobId: latest.id, now });
    if (expired) {
      // Clear the cleanup cursor only after physical deletion. Any failed
      // phase is therefore retried by the bounded recovery pass.
      try {
        await artifacts.delete({ jobId: latest.id });
        return (await jobs.markArtifactDeleted({ jobId: latest.id, now })) ?? expired;
      } catch {
        return expired;
      }
    }
  }
  return latest;
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
