import { type AffectedScope, affectedScopesForOwnerSurfaces } from "./affected-scopes";
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
import { affectedScopesForPerson } from "./people/affected-scopes";
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
  return memoryMutationOutcome(defaultMemoryCapture.captureExplicitMemory(input));
}

export async function captureExplicitMemoryFromSource(input: CaptureExplicitMemoryFromSourceInput) {
  return memoryMutationOutcome(defaultMemoryCapture.captureExplicitMemoryFromSource(input));
}

export async function captureSuggestedMemoryFromSource(
  input: CaptureSuggestedMemoryFromSourceInput,
) {
  return memoryMutationOutcome(defaultMemoryCapture.captureSuggestedMemoryFromSource(input));
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
  return memoryMutationOutcome(defaultMemoryReview.saveSuggestedMemory(input));
}

export async function editSuggestedMemory(input: EditSuggestedMemoryInput) {
  return memoryMutationOutcome(defaultMemoryReview.editSuggestedMemory(input));
}

export async function dismissSuggestedMemory(input: MemoryReviewActionInput) {
  return memoryMutationOutcome(defaultMemoryReview.dismissSuggestedMemory(input));
}

export async function restoreDismissedSuggestedMemory(input: MemoryReviewActionInput) {
  return memoryMutationOutcome(defaultMemoryReview.restoreDismissedSuggestedMemory(input));
}

export async function approveExtractedMemoriesForSourceRecord(
  input: SourceRecordMemoryActionInput,
) {
  return {
    result: await defaultMemoryReview.approveExtractedMemoriesForSourceRecord(input),
    affectedScopes: affectedScopesForOwnerSurfaces(input.ownerUserId),
  };
}

export async function dismissExtractedMemoriesForSourceRecord(
  input: SourceRecordMemoryActionInput,
) {
  return {
    result: await defaultMemoryReview.dismissExtractedMemoriesForSourceRecord(input),
    affectedScopes: affectedScopesForOwnerSurfaces(input.ownerUserId),
  };
}

export async function archiveMemory(input: MemoryReviewActionInput) {
  return memoryMutationOutcome(defaultMemoryReview.archiveMemory(input));
}

export async function memoryMutationOutcome<
  TResult extends
    | { id: string; ownerUserId: string; personId: string }
    | { memory: { id: string; ownerUserId: string; personId: string } },
>(resultPromise: Promise<TResult>) {
  const result = await resultPromise;
  const memory = ("memory" in result ? result.memory : result) as {
    id: string;
    ownerUserId: string;
    personId: string;
  };
  return {
    result,
    affectedScopes: [
      ...affectedScopesForPerson({
        ownerUserId: memory.ownerUserId,
        personId: memory.personId,
      }),
      ...affectedScopesForOwnerSurfaces(memory.ownerUserId),
    ] satisfies AffectedScope[],
  };
}
