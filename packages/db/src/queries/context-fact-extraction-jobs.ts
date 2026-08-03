export type { AiSdkContextFactExtractionAdapterOptions } from "./context-fact-extraction-jobs/ai-sdk-adapter";
export {
  createAiSdkContextFactExtractionAdapter,
  createDefaultContextFactExtractionAdapter,
  hasContextFactExtractionCredentials,
  shouldRunLiveContextFactExtractionQualityEval,
} from "./context-fact-extraction-jobs/ai-sdk-adapter";
export { createDrizzleContextFactExtractionJobStore } from "./context-fact-extraction-jobs/drizzle-store";
export { createInMemoryContextFactExtractionJobStore } from "./context-fact-extraction-jobs/in-memory-store";
export {
  createContextFactExtractionProcessor,
  DEFAULT_CONTEXT_FACT_EXTRACTION_MAX_ATTEMPTS,
  DEFAULT_CONTEXT_FACT_EXTRACTION_RETRY_DELAY_MS,
} from "./context-fact-extraction-jobs/processor";
export type * from "./context-fact-extraction-jobs/runtime";
export {
  enqueueAndTriggerContextFactExtractionJobWithProcessor,
  resolveContextFactExtractionRuntimeMode,
} from "./context-fact-extraction-jobs/runtime";
export type * from "./context-fact-extraction-jobs/types";

import {
  type AiSdkContextFactExtractionAdapterOptions,
  createAiSdkContextFactExtractionAdapter,
  createDefaultContextFactExtractionAdapter,
} from "./context-fact-extraction-jobs/ai-sdk-adapter";
import { createDrizzleContextFactExtractionJobStore } from "./context-fact-extraction-jobs/drizzle-store";
import { createContextFactExtractionProcessor } from "./context-fact-extraction-jobs/processor";
import {
  type EnqueueAndTriggerContextFactExtractionJobInput,
  enqueueAndTriggerContextFactExtractionJobWithProcessor,
} from "./context-fact-extraction-jobs/runtime";

export function createContextFactExtractionJobProcessor(
  input: AiSdkContextFactExtractionAdapterOptions = {},
) {
  return createContextFactExtractionProcessor(createDrizzleContextFactExtractionJobStore(), {
    extractionAdapter:
      input.model || input.promptVersion
        ? createAiSdkContextFactExtractionAdapter(input)
        : createDefaultContextFactExtractionAdapter(input.env),
  });
}

const defaultContextFactExtractionProcessor = createContextFactExtractionJobProcessor();

export async function enqueueContextFactExtractionJob(
  input: Parameters<
    typeof defaultContextFactExtractionProcessor.enqueueContextFactExtractionJob
  >[0],
) {
  return defaultContextFactExtractionProcessor.enqueueContextFactExtractionJob(input);
}

export async function enqueueAndTriggerContextFactExtractionJob(
  input: EnqueueAndTriggerContextFactExtractionJobInput,
) {
  return enqueueAndTriggerContextFactExtractionJobWithProcessor(
    defaultContextFactExtractionProcessor,
    input,
  );
}

export async function claimNextContextFactExtractionJob(input: { now?: Date } = {}) {
  return defaultContextFactExtractionProcessor.claimNextContextFactExtractionJob(input);
}

export async function claimContextFactExtractionJob(input: { jobId: string; now?: Date }) {
  return defaultContextFactExtractionProcessor.claimContextFactExtractionJob(input);
}

export async function getContextFactExtractionJob(jobId: string) {
  return defaultContextFactExtractionProcessor.getContextFactExtractionJob(jobId);
}

export async function processContextFactExtractionJob(
  input: Parameters<
    typeof defaultContextFactExtractionProcessor.processContextFactExtractionJob
  >[0],
) {
  return defaultContextFactExtractionProcessor.processContextFactExtractionJob(input);
}
