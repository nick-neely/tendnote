import type {
  Asset,
  AssetKind,
  AssetStatus,
  GeneralActionStatus,
  PrivacyScope,
} from "@tendnote/domain";

export type AssetDueFilter = "with_due_action" | "without_due_action";
export type AssetReviewFilter = "needs_review" | "ready";
export type AssetBrowseSort = "name" | "due_action" | "needs_review" | "recently_added";

export type AssetBrowseFilters = {
  kinds?: AssetKind[];
  statuses?: AssetStatus[];
  scopes?: PrivacyScope[];
  due?: AssetDueFilter;
  review?: AssetReviewFilter;
};

export type AssetBrowseRow = {
  asset: Asset;
  needsReview: boolean;
  nextDueAction: {
    status: Extract<GeneralActionStatus, "open" | "deferred">;
    dueAt: Date;
    deferUntil: Date | null;
  } | null;
};

export type ListAssetBrowseRowsInput = AssetBrowseFilters & {
  callerUserId: string;
  sort: AssetBrowseSort;
  limit: number;
  offset: number;
};

export type AssetBrowseStore = {
  listAssetBrowseRows: (input: ListAssetBrowseRowsInput) => Promise<AssetBrowseRow[]>;
  countPendingAssetReviews: (input: { ownerUserId: string }) => Promise<number>;
};

export type BrowseAssetsInput = AssetBrowseFilters & {
  callerUserId: string;
  sort?: AssetBrowseSort;
  pageSize?: number;
  offset?: number;
};

export type AssetBrowsePage = {
  items: AssetBrowseRow[];
  reviewCount: number;
  nextOffset: number | null;
};
