import type {
  Confidence,
  CreateMemoryInput,
  Memory,
  MemoryReviewEdit,
  MemoryType,
  Person,
  Sensitivity,
  Source,
  SourceRecord,
  SourceRecordPerson,
  SourceRecordPersonRole,
} from "@tendnote/domain";
import type { InMemorySourceRecordStore, SourceRecordCaptureStore } from "../source-records/types";

export type CaptureExplicitMemoryInput = {
  ownerUserId: string;
  personId: string;
  content: string;
  retainedContent?: string;
  memoryType?: MemoryType;
  sensitivity?: Sensitivity;
  confidence?: Confidence;
  importance?: number;
  sourceType?: Source;
  metadataJson?: Record<string, unknown>;
};

export type CaptureExplicitMemoryResult = {
  memory: Memory;
  sourceRecord: SourceRecord;
  person: Person;
};

export type PersonMemoryContextInput = {
  ownerUserId: string;
  personId: string;
};

export type PersonMemoryContextResult = {
  person: Person | null;
  memories: Memory[];
};

export type MemoryCaptureStore = SourceRecordCaptureStore & {
  getPerson: (input: { ownerUserId: string; personId: string }) => Promise<Person | null>;
  linkSourceRecordPerson: (input: {
    sourceRecordId: string;
    personId: string;
    role: SourceRecordPersonRole;
  }) => Promise<SourceRecordPerson>;
  createMemory: (memory: CreateMemoryInput) => Promise<Memory>;
  listApprovedMemoriesForPerson: (input: {
    ownerUserId: string;
    personId: string;
  }) => Promise<Memory[]>;
  listMemoriesForSourceRecord: (input: { sourceRecordId: string }) => Promise<Memory[]>;
};

export type MemoryUpdatePatch = Partial<
  Pick<
    Memory,
    | "content"
    | "memoryType"
    | "sensitivity"
    | "importance"
    | "confidence"
    | "status"
    | "approvedAt"
    | "dismissedAt"
  >
>;

/**
 * Shared owner-scoped store surface for the suggested-memory review loop. Review
 * mutations load a persisted memory by id, apply a bounded patch (provenance
 * fields stay untouched), and list suggested memories awaiting review.
 */
export type MemoryReviewStore = MemoryCaptureStore & {
  getMemory: (input: { ownerUserId: string; memoryId: string }) => Promise<Memory | null>;
  updateMemory: (input: {
    ownerUserId: string;
    memoryId: string;
    patch: MemoryUpdatePatch;
  }) => Promise<Memory>;
  listSuggestedMemoriesForOwner: (input: {
    ownerUserId: string;
    personId?: string;
    limit?: number;
  }) => Promise<Memory[]>;
};

export type InMemoryMemoryStore = InMemorySourceRecordStore &
  Pick<
    MemoryCaptureStore,
    "createMemory" | "listApprovedMemoriesForPerson" | "listMemoriesForSourceRecord"
  > &
  Pick<MemoryReviewStore, "getMemory" | "updateMemory" | "listSuggestedMemoriesForOwner">;

export type SuggestedMemoryReviewComponent = {
  type: "suggested_memory_review";
  memoryId: string;
  sourceRecordId: string;
};

export type SuggestedMemoryReviewResult = {
  memory: Memory;
  sourceRecord: SourceRecord | null;
  component: SuggestedMemoryReviewComponent;
};

export type ListSuggestedMemoryReviewsInput = {
  ownerUserId: string;
  personId?: string;
  limit?: number;
};

export type MemoryReviewActionInput = {
  ownerUserId: string;
  memoryId: string;
};

export type SaveSuggestedMemoryInput = MemoryReviewActionInput & {
  edit?: MemoryReviewEdit;
};

export type EditSuggestedMemoryInput = MemoryReviewActionInput & {
  edit: MemoryReviewEdit;
};
