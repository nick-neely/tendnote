import type {
  ContextFactImportExtractionAdapter,
  ContextFactImportProviderId,
  ContextFactImportSource,
} from "@tendnote/domain";
import type { AffectedScope } from "../affected-scopes";
import type { InMemoryContextFactStore } from "../context-facts/in-memory-store";
import type { ContextFactStore, SuggestedContextFactReviewResult } from "../context-facts/types";

/** One recorded Self Context import session. Never holds a copy of the paste. */
export type ContextFactImport = {
  id: string;
  ownerUserId: string;
  provider: ContextFactImportProviderId;
  source: ContextFactImportSource;
  textLength: number;
  candidateCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateContextFactImportInput = {
  ownerUserId: string;
  provider: ContextFactImportProviderId;
  source: ContextFactImportSource;
  textLength: number;
  candidateCount: number;
};

export type ContextFactImportLifecycleStore = {
  createContextFactImport: (input: CreateContextFactImportInput) => Promise<ContextFactImport>;
  getContextFactImport: (importId: string) => Promise<ContextFactImport | null>;
  listContextFactImports: (input: { ownerUserId: string }) => Promise<ContextFactImport[]>;
};

/** One shared owner-scoped Context Fact store plus this family's own import records. */
export type ContextFactImportStore = ContextFactStore & ContextFactImportLifecycleStore;

export type InMemoryContextFactImportStore = InMemoryContextFactStore &
  ContextFactImportLifecycleStore;

export type ImportSelfContextFactsInput = {
  callerUserId: string;
  provider: ContextFactImportProviderId;
  text: string;
};

/**
 * What one import did, in the owner's terms. Every count is something the surface
 * says out loud: an import that quietly drops half a paste is not reviewable.
 */
export type ContextFactImportSummary = {
  importId: string;
  provider: ContextFactImportProviderId;
  source: ContextFactImportSource;
  /** Newly proposed for review. */
  suggestedCount: number;
  /** Already waiting for review from an earlier import or conversation. */
  alreadyPendingCount: number;
  /** Held back by review policy, which today means the owner dismissed it before. */
  skippedCount: number;
  /** Lines and candidates Tendnote could not turn into a reviewable fact. */
  unreadableCount: number;
};

export type ImportSelfContextFactsResult = {
  summary: ContextFactImportSummary;
  reviews: SuggestedContextFactReviewResult[];
  affectedScopes: AffectedScope[];
};

export type CreateContextFactImportQueriesOptions = {
  /** Resolves the authenticated caller independently of request payload fields. */
  resolveVerifiedCaller?: () => Promise<string | null>;
  /** Used only when a paste carries no readable Tendnote block. */
  extractionAdapter?: ContextFactImportExtractionAdapter;
};
