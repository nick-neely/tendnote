import { resolveExtractionRuntimeMode } from "../extraction-jobs/runtime";
import type {
  EnqueueActionExtractionJobInput,
  EnqueueActionExtractionJobResult,
  ProcessActionExtractionJobResult,
} from "./types";

/**
 * Enqueue-then-maybe-trigger wrapper mirroring suggested-memory extraction. It reuses the
 * shared extraction runtime mode (`TENDNOTE_EXTRACTION_RUNTIME`, inline outside
 * production) so local capture immediately produces reviewable Suggested General Actions,
 * while production can leave jobs for cron/queue workers.
 */
export type EnqueueAndTriggerActionExtractionJobInput = EnqueueActionExtractionJobInput & {
  runtimeMode?: "enqueue_only" | "inline";
};

export type EnqueueAndTriggerActionExtractionJobResult = EnqueueActionExtractionJobResult & {
  processResult: ProcessActionExtractionJobResult | null;
};

type ActionExtractionRuntimeProcessor = {
  enqueueActionExtractionJob: (
    input: EnqueueActionExtractionJobInput,
  ) => Promise<EnqueueActionExtractionJobResult>;
  processActionExtractionJob: (input: {
    jobId: string;
  }) => Promise<ProcessActionExtractionJobResult>;
};

export async function enqueueAndTriggerActionExtractionJobWithProcessor(
  processor: ActionExtractionRuntimeProcessor,
  input: EnqueueAndTriggerActionExtractionJobInput,
): Promise<EnqueueAndTriggerActionExtractionJobResult> {
  const { runtimeMode, ...enqueueInput } = input;
  const result = await processor.enqueueActionExtractionJob(enqueueInput);
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
    processResult: await processor.processActionExtractionJob({ jobId: result.job.id }),
  };
}
