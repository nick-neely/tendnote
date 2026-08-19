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
export type OwnerDataExportProcessOutcome = "completed" | "failed";

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

/**
 * Process one claimed owner export. The archive is written before the job is
 * marked complete; a duplicate/replayed queue message therefore sees a
 * terminal job and cannot create a second artifact. Artifact writes are
 * idempotent by job id, which also makes recovery after a completion timeout
 * safe.
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

  if (input.claim !== false) {
    const claimed = await deps.jobs.claim({ jobId: input.jobId, now });
    if (!claimed) {
      const latest = await deps.jobs.get({ jobId: input.jobId });
      if (latest?.status === "completed") return { outcome: "completed", job: latest };
      return { outcome: "failed", job: latest, error: "Owner data export job is not claimable." };
    }
  }

  const claimed = await deps.jobs.get({ jobId: input.jobId });
  if (!claimed) return { outcome: "failed", job: null, error: "Owner data export job not found." };

  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  try {
    const archive = await deps.generate({
      ownerUserId: claimed.ownerUserId,
      now,
      expiresAt,
    });
    await deps.artifacts.put({
      jobId: claimed.id,
      ownerUserId: claimed.ownerUserId,
      bytes: archive.bytes,
      expiresAt,
    });
    const completed = await deps.jobs.markCompleted({
      jobId: claimed.id,
      artifactExpiresAt: expiresAt,
      completedAt: now,
    });
    return { outcome: "completed", job: completed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await deps.jobs.markFailed({
      jobId: claimed.id,
      error: message,
      runAfter: new Date(now.getTime() + OWNER_DATA_EXPORT_RETRY_DELAY_MS),
    });
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
  const latest = await jobs.getLatestForOwner({ ownerUserId });
  if (
    latest?.status === "completed" &&
    latest.artifactExpiresAt &&
    latest.artifactExpiresAt <= new Date()
  ) {
    const expired = await jobs.markExpired({ jobId: latest.id });
    if (expired) {
      await createDrizzleOwnerDataExportArtifactStore().delete({ jobId: latest.id });
      return expired;
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
    await artifacts.delete({ jobId: job.id });
    if (await jobs.markExpired({ jobId: job.id, now: input.now })) marked += 1;
  }
  return { scanned: expired.length, expired: marked };
}
