import {
  type AffectedScope,
  affectedScopesForOwnerSurfaces,
} from "@tendnote/db/queries/general-actions";
import {
  type CaptureExplicitMemoryInput,
  createDrizzleMemoryStore,
  createMemoryCapture,
  createMemoryReview,
  type SaveSuggestedMemoryInput,
  type SourceRecordMemoryActionInput,
} from "@tendnote/db/queries/memories";
import { affectedScopesForPerson } from "@tendnote/db/queries/people";
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

export async function captureExplicitMemoryWithEmbeddingDelivery(
  input: CaptureExplicitMemoryInput,
) {
  const result = await memoryCapture.captureExplicitMemory(input);
  return {
    result,
    affectedScopes: memoryScopes(result.memory),
  };
}

export async function saveSuggestedMemoryWithEmbeddingDelivery(input: SaveSuggestedMemoryInput) {
  const result = await memoryReview.saveSuggestedMemory(input);
  return { result, affectedScopes: memoryScopes(result.memory) };
}

export function approveExtractedMemoriesForSourceRecordWithEmbeddingDelivery(
  input: SourceRecordMemoryActionInput,
) {
  return memoryReview.approveExtractedMemoriesForSourceRecord(input).then((result) => ({
    result,
    affectedScopes: affectedScopesForOwnerSurfaces(input.ownerUserId),
  }));
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
  return sourceRecordResolution.captureSourceRecordForPerson(input).then((result) => ({
    result,
    affectedScopes: [
      ...affectedScopesForPerson({ ownerUserId: input.ownerUserId, personId: input.personId }),
      ...affectedScopesForOwnerSurfaces(input.ownerUserId),
    ],
  }));
}

function memoryScopes(memory: { ownerUserId: string; personId: string }): AffectedScope[] {
  return [
    ...affectedScopesForPerson({
      ownerUserId: memory.ownerUserId,
      personId: memory.personId,
    }),
    ...affectedScopesForOwnerSurfaces(memory.ownerUserId),
  ];
}
