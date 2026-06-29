import {
  type CaptureExplicitMemoryInput,
  createDrizzleMemoryStore,
  createMemoryCapture,
  createMemoryReview,
  type SaveSuggestedMemoryInput,
  type SourceRecordMemoryActionInput,
} from "@tendnote/db/queries/memories";
import {
  createDrizzleSourceRecordStore,
  createSourceRecordResolution,
} from "@tendnote/db/queries/source-records";
import type { Sensitivity, Source, SourceRecordPersonRole } from "@tendnote/domain";
import { enqueueAndPublishSemanticEmbeddingJob } from "./embedding-queue";

const memoryStore = createDrizzleMemoryStore();
const memoryCapture = createMemoryCapture(memoryStore, {
  scheduleApprovedMemoryEmbedding: enqueueAndPublishSemanticEmbeddingJob,
});
const memoryReview = createMemoryReview(memoryStore, {
  scheduleApprovedMemoryEmbedding: enqueueAndPublishSemanticEmbeddingJob,
});

const sourceRecordResolution = createSourceRecordResolution(createDrizzleSourceRecordStore(), {
  scheduleSourceRecordEmbedding: enqueueAndPublishSemanticEmbeddingJob,
});

export function captureExplicitMemoryWithEmbeddingDelivery(input: CaptureExplicitMemoryInput) {
  return memoryCapture.captureExplicitMemory(input);
}

export function saveSuggestedMemoryWithEmbeddingDelivery(input: SaveSuggestedMemoryInput) {
  return memoryReview.saveSuggestedMemory(input);
}

export function approveExtractedMemoriesForSourceRecordWithEmbeddingDelivery(
  input: SourceRecordMemoryActionInput,
) {
  return memoryReview.approveExtractedMemoriesForSourceRecord(input);
}

export function captureSourceRecordForPersonWithEmbeddingDelivery(input: {
  ownerUserId: string;
  personId: string;
  retainedContent: string;
  sourceType?: Source;
  sensitivity?: Sensitivity;
  role?: SourceRecordPersonRole;
  metadataJson?: Record<string, unknown>;
}) {
  return sourceRecordResolution.captureSourceRecordForPerson(input);
}
