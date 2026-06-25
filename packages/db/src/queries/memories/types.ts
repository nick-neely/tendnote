import type {
  Confidence,
  CreateMemoryInput,
  Memory,
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

export type InMemoryMemoryStore = InMemorySourceRecordStore &
  Pick<
    MemoryCaptureStore,
    "createMemory" | "listApprovedMemoriesForPerson" | "listMemoriesForSourceRecord"
  >;
