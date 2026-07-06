import {
  type AiSdkSuggestedActionExtractionAdapterOptions,
  createAiSdkSuggestedActionExtractionAdapter,
  createDefaultSuggestedActionExtractionAdapter,
} from "./action-extraction-jobs/ai-sdk-adapter";
import { createDrizzleActionExtractionJobStore } from "./action-extraction-jobs/drizzle-store";
import { createActionExtractionProcessor } from "./action-extraction-jobs/processor";
import {
  type EnqueueAndTriggerActionExtractionJobInput,
  enqueueAndTriggerActionExtractionJobWithProcessor,
} from "./action-extraction-jobs/runtime";
import type {
  EnqueueActionExtractionJobInput,
  ProcessActionExtractionJobInput,
} from "./action-extraction-jobs/types";

export type { AiSdkSuggestedActionExtractionAdapterOptions } from "./action-extraction-jobs/ai-sdk-adapter";
export {
  createAiSdkSuggestedActionExtractionAdapter,
  createDefaultSuggestedActionExtractionAdapter,
  hasSuggestedActionExtractionCredentials,
} from "./action-extraction-jobs/ai-sdk-adapter";
export { createDrizzleActionExtractionJobStore } from "./action-extraction-jobs/drizzle-store";
export { createInMemoryActionExtractionJobStore } from "./action-extraction-jobs/in-memory-store";
export {
  createActionExtractionProcessor,
  DEFAULT_ACTION_EXTRACTION_RETRY_DELAY_MS,
} from "./action-extraction-jobs/processor";
export type * from "./action-extraction-jobs/runtime";
export { enqueueAndTriggerActionExtractionJobWithProcessor } from "./action-extraction-jobs/runtime";
export type * from "./action-extraction-jobs/types";

export function createActionExtractionJobProcessor(
  input: AiSdkSuggestedActionExtractionAdapterOptions = {},
) {
  return createActionExtractionProcessor(createDrizzleActionExtractionJobStore(), {
    extractionAdapter:
      input.model || input.promptVersion
        ? createAiSdkSuggestedActionExtractionAdapter(input)
        : createDefaultSuggestedActionExtractionAdapter(input.env),
  });
}

const defaultActionExtractionProcessor = createActionExtractionJobProcessor();

export async function enqueueActionExtractionJob(input: EnqueueActionExtractionJobInput) {
  return defaultActionExtractionProcessor.enqueueActionExtractionJob(input);
}

export async function enqueueAndTriggerActionExtractionJob(
  input: EnqueueAndTriggerActionExtractionJobInput,
) {
  return enqueueAndTriggerActionExtractionJobWithProcessor(defaultActionExtractionProcessor, input);
}

export async function claimNextActionExtractionJob(input: { now?: Date } = {}) {
  return defaultActionExtractionProcessor.claimNextActionExtractionJob(input);
}

export async function claimActionExtractionJob(input: { jobId: string; now?: Date }) {
  return defaultActionExtractionProcessor.claimActionExtractionJob(input);
}

export async function getActionExtractionJob(jobId: string) {
  return defaultActionExtractionProcessor.getActionExtractionJob(jobId);
}

export async function processActionExtractionJob(input: ProcessActionExtractionJobInput) {
  return defaultActionExtractionProcessor.processActionExtractionJob(input);
}
