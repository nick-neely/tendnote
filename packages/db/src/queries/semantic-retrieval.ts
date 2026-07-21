import { createAiSdkEmbeddingAdapter } from "./semantic-retrieval/ai-sdk-adapter";
import { createDrizzleEmbeddingStore } from "./semantic-retrieval/drizzle-store";
import { createFakeEmbeddingAdapter } from "./semantic-retrieval/fake-adapter";
import { createEmbeddingProcessor, DEFAULT_EMBEDDING_CONFIG } from "./semantic-retrieval/processor";
import { createSemanticRetrievalQueries } from "./semantic-retrieval/queries";
import {
  type EnqueueAndTriggerSemanticEmbeddingJobInput,
  enqueueAndTriggerSemanticEmbeddingJobWithProcessor,
} from "./semantic-retrieval/runtime";
import type {
  ClaimEmbeddingJobInput,
  EmbeddingAdapter,
  EmbeddingConfig,
  EnqueueEmbeddingJobInput,
  ProcessEmbeddingJobInput,
  SearchSavedItemsSemanticRequest,
  SearchSemanticContextRequest,
} from "./semantic-retrieval/types";

export { createAiSdkEmbeddingAdapter } from "./semantic-retrieval/ai-sdk-adapter";
export { createDrizzleEmbeddingStore } from "./semantic-retrieval/drizzle-store";
export { createFakeEmbeddingAdapter, fakeVectorForText } from "./semantic-retrieval/fake-adapter";
export { createInMemoryEmbeddingStore } from "./semantic-retrieval/in-memory-store";
export {
  createEmbeddingProcessor,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_EMBEDDING_RETRY_DELAY_MS,
  fingerprintEmbeddedText,
} from "./semantic-retrieval/processor";
export { createSemanticRetrievalQueries } from "./semantic-retrieval/queries";
export type * from "./semantic-retrieval/runtime";
export {
  enqueueAndTriggerSemanticEmbeddingJobWithProcessor,
  resolveSemanticEmbeddingRuntimeMode,
} from "./semantic-retrieval/runtime";
export type * from "./semantic-retrieval/types";

type SemanticRetrievalEnv = Record<string, string | undefined>;

function hasGatewayCredentials(env: SemanticRetrievalEnv = process.env) {
  return Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
}

export function createDefaultSemanticEmbeddingConfig(
  env: SemanticRetrievalEnv = process.env,
): EmbeddingConfig {
  if (!hasGatewayCredentials(env)) {
    return DEFAULT_EMBEDDING_CONFIG;
  }

  const model = env.TENDNOTE_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";

  return {
    model,
    version: env.TENDNOTE_EMBEDDING_VERSION ?? model,
  };
}

export function createDefaultSemanticEmbeddingAdapter(
  env: SemanticRetrievalEnv = process.env,
): EmbeddingAdapter {
  return hasGatewayCredentials(env) ? createAiSdkEmbeddingAdapter() : createFakeEmbeddingAdapter();
}

const defaultEmbeddingStore = createDrizzleEmbeddingStore();
const defaultEmbeddingAdapter = createDefaultSemanticEmbeddingAdapter();
const defaultEmbeddingConfig = createDefaultSemanticEmbeddingConfig();
const defaultProcessor = createEmbeddingProcessor(
  defaultEmbeddingStore,
  defaultEmbeddingAdapter,
  defaultEmbeddingConfig,
);
const defaultSemanticRetrieval = createSemanticRetrievalQueries(
  defaultEmbeddingStore,
  defaultEmbeddingAdapter,
  defaultEmbeddingConfig,
);

export function createSemanticEmbeddingProcessor({
  adapter = createDefaultSemanticEmbeddingAdapter(),
  config = createDefaultSemanticEmbeddingConfig(),
}: {
  adapter?: EmbeddingAdapter;
  config?: EmbeddingConfig;
} = {}) {
  return createEmbeddingProcessor(createDrizzleEmbeddingStore(), adapter, config);
}

export async function enqueueSemanticEmbeddingJob(input: EnqueueEmbeddingJobInput) {
  return defaultProcessor.enqueueEmbeddingJob(input);
}

export async function enqueueAndTriggerSemanticEmbeddingJob(
  input: EnqueueAndTriggerSemanticEmbeddingJobInput,
) {
  return enqueueAndTriggerSemanticEmbeddingJobWithProcessor(defaultProcessor, input);
}

export async function claimNextSemanticEmbeddingJob(input: { now?: Date } = {}) {
  return defaultProcessor.claimNextEmbeddingJob(input);
}

export async function processSemanticEmbeddingJob(input: ProcessEmbeddingJobInput) {
  return defaultProcessor.processEmbeddingJob(input);
}

export async function claimSemanticEmbeddingJob(input: ClaimEmbeddingJobInput) {
  return defaultProcessor.claimEmbeddingJob(input);
}

export async function getSemanticEmbeddingJob(jobId: string) {
  return defaultProcessor.getEmbeddingJob(jobId);
}

export async function searchSemanticContext(input: SearchSemanticContextRequest) {
  return defaultSemanticRetrieval.searchSemanticContext(input);
}

export async function searchSavedItemsSemantic(input: SearchSavedItemsSemanticRequest) {
  return defaultSemanticRetrieval.searchSavedItemsSemantic(input);
}
