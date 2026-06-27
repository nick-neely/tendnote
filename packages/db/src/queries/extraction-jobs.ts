import { createDrizzleExtractionJobStore } from "./extraction-jobs/drizzle-store";
import { createExtractionProcessor } from "./extraction-jobs/processor";
import {
  type EnqueueAndTriggerExtractionJobInput,
  enqueueAndTriggerExtractionJobWithProcessor,
} from "./extraction-jobs/runtime";
import type { EnqueueExtractionJobInput, ProcessExtractionJobInput } from "./extraction-jobs/types";

export { createDrizzleExtractionJobStore } from "./extraction-jobs/drizzle-store";
export { createInMemoryExtractionJobStore } from "./extraction-jobs/in-memory-store";
export {
  createExtractionProcessor,
  DEFAULT_EXTRACTION_RETRY_DELAY_MS,
} from "./extraction-jobs/processor";
export type * from "./extraction-jobs/runtime";
export {
  enqueueAndTriggerExtractionJobWithProcessor,
  resolveExtractionRuntimeMode,
} from "./extraction-jobs/runtime";
export type * from "./extraction-jobs/types";

const defaultExtractionJobStore = createDrizzleExtractionJobStore();
const defaultExtractionProcessor = createExtractionProcessor(defaultExtractionJobStore);

export async function enqueueExtractionJob(input: EnqueueExtractionJobInput) {
  return defaultExtractionProcessor.enqueueExtractionJob(input);
}

export async function enqueueAndTriggerExtractionJob(input: EnqueueAndTriggerExtractionJobInput) {
  return enqueueAndTriggerExtractionJobWithProcessor(defaultExtractionProcessor, input);
}

export async function claimNextExtractionJob(input: { now?: Date } = {}) {
  return defaultExtractionProcessor.claimNextExtractionJob(input);
}

export async function processExtractionJob(input: ProcessExtractionJobInput) {
  return defaultExtractionProcessor.processExtractionJob(input);
}
