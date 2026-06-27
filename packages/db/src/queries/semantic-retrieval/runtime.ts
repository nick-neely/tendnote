import type {
  EnqueueEmbeddingJobInput,
  EnqueueEmbeddingJobResult,
  ProcessEmbeddingJobResult,
} from "./types";

export type SemanticEmbeddingRuntimeMode = "enqueue_only" | "inline";

export type EnqueueAndTriggerSemanticEmbeddingJobInput = EnqueueEmbeddingJobInput & {
  /**
   * Defaults to inline outside production so local capture/search can exercise
   * semantic retrieval immediately. Production leaves jobs for workers unless
   * TENDNOTE_EMBEDDING_RUNTIME=inline is set.
   */
  runtimeMode?: SemanticEmbeddingRuntimeMode;
};

export type EnqueueAndTriggerSemanticEmbeddingJobResult = EnqueueEmbeddingJobResult & {
  processResult: ProcessEmbeddingJobResult | null;
};

type SemanticEmbeddingRuntimeProcessor = {
  enqueueEmbeddingJob: (input: EnqueueEmbeddingJobInput) => Promise<EnqueueEmbeddingJobResult>;
  processEmbeddingJob: (input: { jobId: string }) => Promise<ProcessEmbeddingJobResult>;
};

export function resolveSemanticEmbeddingRuntimeMode(input: {
  configured?: string;
  nodeEnv?: string;
}): SemanticEmbeddingRuntimeMode {
  if (input.configured === "inline" || input.configured === "enqueue_only") {
    return input.configured;
  }

  return input.nodeEnv === "production" ? "enqueue_only" : "inline";
}

export async function enqueueAndTriggerSemanticEmbeddingJobWithProcessor(
  processor: SemanticEmbeddingRuntimeProcessor,
  input: EnqueueAndTriggerSemanticEmbeddingJobInput,
): Promise<EnqueueAndTriggerSemanticEmbeddingJobResult> {
  const { runtimeMode, ...enqueueInput } = input;
  const result = await processor.enqueueEmbeddingJob(enqueueInput);
  const mode =
    runtimeMode ??
    resolveSemanticEmbeddingRuntimeMode({
      configured: process.env.TENDNOTE_EMBEDDING_RUNTIME,
      nodeEnv: process.env.NODE_ENV,
    });

  if (mode === "enqueue_only") {
    return { ...result, processResult: null };
  }

  return {
    ...result,
    processResult: await processor.processEmbeddingJob({ jobId: result.job.id }),
  };
}
