import { createMemoryCapture } from "./memories/capture";
import { createDrizzleMemoryStore } from "./memories/drizzle-store";
import { createMemoryReview } from "./memories/review";
import type {
  CaptureExplicitMemoryFromSourceInput,
  CaptureExplicitMemoryInput,
  CaptureSuggestedMemoryFromSourceInput,
  EditSuggestedMemoryInput,
  ListSuggestedMemoryReviewsInput,
  MemoryReviewActionInput,
  PersonMemoryContextInput,
  SaveSuggestedMemoryInput,
  SourceRecordMemoryActionInput,
} from "./memories/types";
import { enqueueAndTriggerSemanticEmbeddingJob } from "./semantic-retrieval";

export { createMemoryCapture } from "./memories/capture";
export { createDrizzleMemoryStore } from "./memories/drizzle-store";
export { createInMemoryMemoryStore } from "./memories/in-memory-store";
export { createMemoryReview } from "./memories/review";
export type * from "./memories/types";

const defaultMemoryStore = createDrizzleMemoryStore();
const scheduleApprovedMemoryEmbedding = enqueueAndTriggerSemanticEmbeddingJob;
const defaultMemoryCapture = createMemoryCapture(defaultMemoryStore, {
  scheduleApprovedMemoryEmbedding,
});
const defaultMemoryReview = createMemoryReview(defaultMemoryStore, {
  scheduleApprovedMemoryEmbedding,
});

export async function captureExplicitMemory(input: CaptureExplicitMemoryInput) {
  return defaultMemoryCapture.captureExplicitMemory(input);
}

export async function captureExplicitMemoryFromSource(input: CaptureExplicitMemoryFromSourceInput) {
  return defaultMemoryCapture.captureExplicitMemoryFromSource(input);
}

export async function captureSuggestedMemoryFromSource(
  input: CaptureSuggestedMemoryFromSourceInput,
) {
  return defaultMemoryCapture.captureSuggestedMemoryFromSource(input);
}

export async function listPersonMemoryContext(input: PersonMemoryContextInput) {
  return defaultMemoryCapture.listPersonMemoryContext(input);
}

export async function listSuggestedMemoryReviews(input: ListSuggestedMemoryReviewsInput) {
  return defaultMemoryReview.listSuggestedMemoryReviews(input);
}

export async function getSuggestedMemoryReview(input: MemoryReviewActionInput) {
  return defaultMemoryReview.getSuggestedMemoryReview(input);
}

export async function getMemory(input: MemoryReviewActionInput) {
  return defaultMemoryStore.getMemory(input);
}

export async function saveSuggestedMemory(input: SaveSuggestedMemoryInput) {
  return defaultMemoryReview.saveSuggestedMemory(input);
}

export async function editSuggestedMemory(input: EditSuggestedMemoryInput) {
  return defaultMemoryReview.editSuggestedMemory(input);
}

export async function dismissSuggestedMemory(input: MemoryReviewActionInput) {
  return defaultMemoryReview.dismissSuggestedMemory(input);
}

export async function approveExtractedMemoriesForSourceRecord(
  input: SourceRecordMemoryActionInput,
) {
  return defaultMemoryReview.approveExtractedMemoriesForSourceRecord(input);
}

export async function dismissExtractedMemoriesForSourceRecord(
  input: SourceRecordMemoryActionInput,
) {
  return defaultMemoryReview.dismissExtractedMemoriesForSourceRecord(input);
}

export async function archiveMemory(input: MemoryReviewActionInput) {
  return defaultMemoryReview.archiveMemory(input);
}
