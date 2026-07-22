import type {
  CalendarReadResult,
  ExactRecallResult,
  GlobalRecallInput,
  GlobalRecallResponse,
  SavedItemSemanticResult,
  SemanticRetrievalResult,
} from "@tendnote/domain";
import type { AssetSearchOutcome } from "../asset-search/types";
import type { OwnerCalendarReadOutcome } from "../calendar";
import type { ActiveFollowupSummary } from "../followups/types";
import type { SavedItemWithContext } from "../saved-items/types";

export type SearchGlobalRecallRequest = GlobalRecallInput & { ownerUserId: string };

export type GlobalRecallDependencies = {
  searchRelationshipExact: (input: {
    ownerUserId: string;
    query: string;
    directlyRequested: boolean;
    includeArchived: boolean;
    limit: number;
  }) => Promise<ExactRecallResult[]>;
  searchRelationshipRelated: (input: {
    ownerUserId: string;
    query: string;
    directlyRequested: boolean;
    includeArchived: boolean;
    minimumSimilarity: number;
    limit: number;
  }) => Promise<SemanticRetrievalResult[]>;
  searchAssets: (input: {
    ownerUserId: string;
    query: string;
    includeArchived: boolean;
    limit: number;
  }) => Promise<AssetSearchOutcome>;
  searchSavedItemsExact: (input: {
    callerUserId: string;
    query: string;
    includeArchived: boolean;
    limit: number;
  }) => Promise<SavedItemWithContext[]>;
  searchSavedItemsRelated: (input: {
    ownerUserId: string;
    query: string;
    includeArchived: boolean;
    minimumSimilarity: number;
    limit: number;
  }) => Promise<SavedItemSemanticResult[]>;
  listFollowups: (input: {
    ownerUserId: string;
    includeArchived: boolean;
    limit: number;
  }) => Promise<ActiveFollowupSummary[]>;
  readCalendar: (input: {
    ownerUserId: string;
    query: string;
  }) => Promise<
    OwnerCalendarReadOutcome | { connected: boolean; result: CalendarReadResult | null }
  >;
};

export type GlobalRecall = {
  search: (input: SearchGlobalRecallRequest) => Promise<GlobalRecallResponse>;
};
