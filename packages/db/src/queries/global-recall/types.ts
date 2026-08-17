import type {
  ExactRecallResult,
  GlobalRecallInput,
  GlobalRecallResponse,
  SavedItemSemanticResult,
  SemanticRetrievalResult,
} from "@tendnote/domain";
import type { AssetSearchOutcome } from "../asset-search/types";
import type { OwnerCalendarReadOutcome } from "../calendar";
import type { HouseholdContextExactResult, SelfContextExactResult } from "../context-facts/types";
import type { ActiveFollowupSummary } from "../followups/types";
import type { GiftPlanWithContext } from "../gift-plans/types";
import type { SavedItemWithContext } from "../saved-items/types";

export type SearchGlobalRecallRequest = GlobalRecallInput & { ownerUserId: string };

export type GlobalRecallDependencies = {
  searchSelfContextExact: (input: {
    callerUserId: string;
    query: string;
    directlyRequested: boolean;
    includeArchived: boolean;
    limit: number;
  }) => Promise<SelfContextExactResult[]>;
  /**
   * No `includeArchived`, unlike every other exact read here. An archived
   * household fact is a statement the household has taken down together, and
   * putting it back in front of one member because they ticked "include
   * archived" would re-publish it to a shared audience that never agreed to it.
   * Archived Household Context is reachable only from the management page.
   */
  searchHouseholdContextExact: (input: {
    callerUserId: string;
    query: string;
    directlyRequested: boolean;
    limit: number;
  }) => Promise<HouseholdContextExactResult[]>;
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
  /**
   * The Gift Plans this caller may see, from the Gift Plan seam's own proved
   * search.
   *
   * Deliberately the seam's function rather than a query of its own: the seam
   * narrows in SQL, proves every surviving row, and refuses the Surprise Subject
   * at both gates. A second query here would be a second answer to who may see a
   * plan, and the one that eventually disagrees is the leak (ADR 0216).
   *
   * No `includeArchived`, like Household Context above and for a related reason:
   * recall is a live question about what is being planned, and an archived plan is
   * one the owner has put away. It stays reachable from its own surface.
   */
  searchGiftPlans: (input: {
    callerUserId: string;
    query: string;
    limit: number;
  }) => Promise<GiftPlanWithContext[]>;
  listFollowups: (input: {
    ownerUserId: string;
    includeArchived: boolean;
    limit: number;
  }) => Promise<ActiveFollowupSummary[]>;
  readCalendar: (input: {
    ownerUserId: string;
    query: string;
  }) => Promise<OwnerCalendarReadOutcome>;
};

export type GlobalRecall = {
  search: (input: SearchGlobalRecallRequest) => Promise<GlobalRecallResponse>;
};
