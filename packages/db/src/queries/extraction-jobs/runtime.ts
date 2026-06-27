import type {
  EnqueueExtractionJobInput,
  EnqueueExtractionJobResult,
  ProcessExtractionJobResult,
} from "./types";

export type ExtractionRuntimeMode = "enqueue_only" | "inline";

export type EnqueueAndTriggerExtractionJobInput = EnqueueExtractionJobInput & {
  /**
   * Defaults to inline outside production so local capture immediately produces
   * reviewable suggestions. Production can set TENDNOTE_EXTRACTION_RUNTIME=inline
   * for the same behavior, or leave jobs for cron/queue workers.
   */
  runtimeMode?: ExtractionRuntimeMode;
};

export type EnqueueAndTriggerExtractionJobResult = EnqueueExtractionJobResult & {
  processResult: ProcessExtractionJobResult | null;
};

type ExtractionRuntimeProcessor = {
  enqueueExtractionJob: (input: EnqueueExtractionJobInput) => Promise<EnqueueExtractionJobResult>;
  processExtractionJob: (input: { jobId: string }) => Promise<ProcessExtractionJobResult>;
};

export function resolveExtractionRuntimeMode(input: {
  configured?: string;
  nodeEnv?: string;
}): ExtractionRuntimeMode {
  if (input.configured === "inline" || input.configured === "enqueue_only") {
    return input.configured;
  }

  return input.nodeEnv === "production" ? "enqueue_only" : "inline";
}

export async function enqueueAndTriggerExtractionJobWithProcessor(
  processor: ExtractionRuntimeProcessor,
  input: EnqueueAndTriggerExtractionJobInput,
): Promise<EnqueueAndTriggerExtractionJobResult> {
  const { runtimeMode, ...enqueueInput } = input;
  const result = await processor.enqueueExtractionJob(enqueueInput);
  const mode =
    runtimeMode ??
    resolveExtractionRuntimeMode({
      configured: process.env.TENDNOTE_EXTRACTION_RUNTIME,
      nodeEnv: process.env.NODE_ENV,
    });

  if (mode === "enqueue_only") {
    return { ...result, processResult: null };
  }

  return {
    ...result,
    processResult: await processor.processExtractionJob({ jobId: result.job.id }),
  };
}
