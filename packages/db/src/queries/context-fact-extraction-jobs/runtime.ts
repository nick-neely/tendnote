import type {
  EnqueueContextFactExtractionJobInput,
  EnqueueContextFactExtractionJobResult,
  ProcessContextFactExtractionJobResult,
} from "./types";

export type ContextFactExtractionRuntimeMode = "enqueue_only" | "inline";

export type EnqueueAndTriggerContextFactExtractionJobInput =
  EnqueueContextFactExtractionJobInput & {
    runtimeMode?: ContextFactExtractionRuntimeMode;
  };

export type EnqueueAndTriggerContextFactExtractionJobResult =
  EnqueueContextFactExtractionJobResult & {
    processResult: ProcessContextFactExtractionJobResult | null;
  };

export function resolveContextFactExtractionRuntimeMode(input: {
  configured?: string;
  nodeEnv?: string;
}): ContextFactExtractionRuntimeMode {
  if (input.configured === "inline" || input.configured === "enqueue_only") {
    return input.configured;
  }
  return input.nodeEnv === "production" ? "enqueue_only" : "inline";
}

type ContextFactExtractionRuntimeProcessor = {
  enqueueContextFactExtractionJob: (
    input: EnqueueContextFactExtractionJobInput,
  ) => Promise<EnqueueContextFactExtractionJobResult>;
  processContextFactExtractionJob: (input: {
    jobId: string;
  }) => Promise<ProcessContextFactExtractionJobResult>;
};

export async function enqueueAndTriggerContextFactExtractionJobWithProcessor(
  processor: ContextFactExtractionRuntimeProcessor,
  input: EnqueueAndTriggerContextFactExtractionJobInput,
): Promise<EnqueueAndTriggerContextFactExtractionJobResult> {
  const { runtimeMode, ...enqueueInput } = input;
  const result = await processor.enqueueContextFactExtractionJob(enqueueInput);
  const mode =
    runtimeMode ??
    resolveContextFactExtractionRuntimeMode({
      configured: process.env.TENDNOTE_CONTEXT_FACT_EXTRACTION_RUNTIME,
      nodeEnv: process.env.NODE_ENV,
    });

  if (mode === "enqueue_only") {
    return { ...result, processResult: null };
  }

  return {
    ...result,
    processResult: await processor.processContextFactExtractionJob({ jobId: result.job.id }),
  };
}
