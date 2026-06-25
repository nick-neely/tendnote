import { createMemoryCapture } from "./memories/capture";
import { createDrizzleMemoryStore } from "./memories/drizzle-store";
import { createMemoryReview } from "./memories/review";
import type {
  CaptureExplicitMemoryInput,
  EditSuggestedMemoryInput,
  ListSuggestedMemoryReviewsInput,
  MemoryReviewActionInput,
  PersonMemoryContextInput,
  SaveSuggestedMemoryInput,
} from "./memories/types";

export { createMemoryCapture } from "./memories/capture";
export { createDrizzleMemoryStore } from "./memories/drizzle-store";
export { createInMemoryMemoryStore } from "./memories/in-memory-store";
export { createMemoryReview } from "./memories/review";
export type * from "./memories/types";

const defaultMemoryStore = createDrizzleMemoryStore();
const defaultMemoryCapture = createMemoryCapture(defaultMemoryStore);
const defaultMemoryReview = createMemoryReview(defaultMemoryStore);

export async function captureExplicitMemory(input: CaptureExplicitMemoryInput) {
  return defaultMemoryCapture.captureExplicitMemory(input);
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

export async function saveSuggestedMemory(input: SaveSuggestedMemoryInput) {
  return defaultMemoryReview.saveSuggestedMemory(input);
}

export async function editSuggestedMemory(input: EditSuggestedMemoryInput) {
  return defaultMemoryReview.editSuggestedMemory(input);
}

export async function dismissSuggestedMemory(input: MemoryReviewActionInput) {
  return defaultMemoryReview.dismissSuggestedMemory(input);
}

export async function archiveMemory(input: MemoryReviewActionInput) {
  return defaultMemoryReview.archiveMemory(input);
}
