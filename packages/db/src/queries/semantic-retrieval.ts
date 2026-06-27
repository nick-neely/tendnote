import { createDrizzleEmbeddingStore } from "./semantic-retrieval/drizzle-store";
import { createFakeEmbeddingAdapter } from "./semantic-retrieval/fake-adapter";
import { createEmbeddingProcessor, DEFAULT_EMBEDDING_CONFIG } from "./semantic-retrieval/processor";
import type {
  EmbeddingAdapter,
  EmbeddingConfig,
  EnqueueEmbeddingJobInput,
  ProcessEmbeddingJobInput,
} from "./semantic-retrieval/types";

export { createDrizzleEmbeddingStore } from "./semantic-retrieval/drizzle-store";
export { createFakeEmbeddingAdapter, fakeVectorForText } from "./semantic-retrieval/fake-adapter";
export { createInMemoryEmbeddingStore } from "./semantic-retrieval/in-memory-store";
export {
  createEmbeddingProcessor,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_EMBEDDING_RETRY_DELAY_MS,
  fingerprintEmbeddedText,
} from "./semantic-retrieval/processor";
export type * from "./semantic-retrieval/types";

const defaultProcessor = createEmbeddingProcessor(
  createDrizzleEmbeddingStore(),
  createFakeEmbeddingAdapter(),
  DEFAULT_EMBEDDING_CONFIG,
);

export function createSemanticEmbeddingProcessor(input?: {
  adapter?: EmbeddingAdapter;
  config?: EmbeddingConfig;
}) {
  return createEmbeddingProcessor(
    createDrizzleEmbeddingStore(),
    input?.adapter ?? createFakeEmbeddingAdapter(),
    input?.config ?? DEFAULT_EMBEDDING_CONFIG,
  );
}

export async function enqueueSemanticEmbeddingJob(input: EnqueueEmbeddingJobInput) {
  return defaultProcessor.enqueueEmbeddingJob(input);
}

export async function processSemanticEmbeddingJob(input: ProcessEmbeddingJobInput) {
  return defaultProcessor.processEmbeddingJob(input);
}
