import type { Sensitivity, Source, SourceRecordPersonRole } from "@tendnote/domain";
import { enqueueAndTriggerSemanticEmbeddingJob } from "./semantic-retrieval";
import { createSourceRecordCapture } from "./source-records/capture";
import { createDrizzleSourceRecordStore } from "./source-records/drizzle-store";
import { createSourceRecordResolution } from "./source-records/resolution";
import type {
  CaptureSourceRecordInput,
  GetSourceRecordReviewInput,
  ListSourceRecordReviewsInput,
} from "./source-records/types";

export { createSourceRecordCapture } from "./source-records/capture";
export {
  type CaptureLoggedContextDeps,
  type CaptureLoggedContextInput,
  type CaptureSurface,
  captureLoggedContext,
} from "./source-records/capture-logged-context";
export {
  createDrizzleSourceRecordStore,
  listSourceRecordReviews,
} from "./source-records/drizzle-store";
export { createInMemorySourceRecordStore } from "./source-records/in-memory-store";
export { createSourceRecordResolution } from "./source-records/resolution";
export type * from "./source-records/types";

const defaultSourceRecordStore = createDrizzleSourceRecordStore();
const defaultSourceRecordCapture = createSourceRecordCapture(defaultSourceRecordStore);
const defaultSourceRecordResolution = createSourceRecordResolution(defaultSourceRecordStore, {
  scheduleSourceRecordEmbedding: enqueueAndTriggerSemanticEmbeddingJob,
});

export async function captureSourceRecord(input: CaptureSourceRecordInput) {
  return defaultSourceRecordCapture.captureSourceRecord(input);
}

export async function getSourceRecordReview(input: GetSourceRecordReviewInput) {
  return defaultSourceRecordCapture.getSourceRecordReview(input);
}

export async function findPersonResolutionCandidates(input: {
  ownerUserId: string;
  mentionText: string;
  limit?: number;
}) {
  return defaultSourceRecordResolution.findPersonResolutionCandidates(input);
}

export async function linkSourceRecordToExistingPerson(input: {
  ownerUserId: string;
  sourceRecordId: string;
  personId: string;
  role?: SourceRecordPersonRole;
  unresolvedMentionId?: string;
}) {
  return defaultSourceRecordResolution.linkSourceRecordToExistingPerson(input);
}

export async function createAndLinkPersonToSourceRecord(input: {
  ownerUserId: string;
  sourceRecordId: string;
  displayName: string;
  role?: SourceRecordPersonRole;
  unresolvedMentionId?: string;
}) {
  return defaultSourceRecordResolution.createAndLinkPersonToSourceRecord(input);
}

export async function resolveOrCreateAndLinkPersonToSourceRecord(input: {
  ownerUserId: string;
  sourceRecordId: string;
  displayName: string;
  role?: SourceRecordPersonRole;
  unresolvedMentionId?: string;
}) {
  const candidates = await defaultSourceRecordResolution.findPersonResolutionCandidates({
    ownerUserId: input.ownerUserId,
    mentionText: input.displayName,
    limit: 10,
  });
  const normalized = input.displayName.trim().toLocaleLowerCase();
  const exact = candidates.filter(
    (person) => person.displayName.trim().toLocaleLowerCase() === normalized,
  );
  if (exact.length > 1) {
    throw new Error("More than one Person has that name. Link one instead.");
  }
  const person = exact[0];
  if (person) {
    return {
      ...(await defaultSourceRecordResolution.linkSourceRecordToExistingPerson({
        ...input,
        personId: person.id,
      })),
      created: false as const,
    };
  }
  return {
    ...(await defaultSourceRecordResolution.createAndLinkPersonToSourceRecord(input)),
    created: true as const,
  };
}

export async function unlinkSourceRecordFromPerson(input: {
  ownerUserId: string;
  sourceRecordId: string;
  personId: string;
}) {
  return defaultSourceRecordResolution.unlinkSourceRecordFromPerson(input);
}

export async function ignoreUnresolvedMention(input: {
  ownerUserId: string;
  sourceRecordId: string;
  unresolvedMentionId?: string;
}) {
  return defaultSourceRecordResolution.ignoreUnresolvedMention(input);
}

export async function listSourceRecordsForPersonContext(input: {
  ownerUserId: string;
  personId: string;
}) {
  return defaultSourceRecordResolution.listSourceRecordsForPersonContext(input);
}

export async function captureSourceRecordForPerson(input: {
  ownerUserId: string;
  personId: string;
  retainedContent: string;
  sourceType?: Source;
  sensitivity?: Sensitivity;
  role?: SourceRecordPersonRole;
  metadataJson?: Record<string, unknown>;
}) {
  return defaultSourceRecordResolution.captureSourceRecordForPerson(input);
}

export type { ListSourceRecordReviewsInput };
