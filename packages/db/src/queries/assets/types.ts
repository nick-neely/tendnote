import type {
  Asset,
  AssetAuditEvent,
  AssetAuditSource,
  AssetEdit,
  AssetKind,
  AssetStatus,
  CreateAssetAuditEventInput,
  CreateAssetInput,
  PrivacyScope,
} from "@tendnote/domain";
import type { HouseholdStore } from "../households/types";

/** Bounded patch the lifecycle layer may apply to a persisted Asset. */
export type AssetPatch = Partial<
  Pick<
    Asset,
    "name" | "kind" | "status" | "scope" | "householdId" | "archivedAt" | "lastActorUserId"
  >
>;

/**
 * A persisted Asset hydrated for a surface read: the audience detail behind its
 * scope so the surface can say *who* can see it, not just that it is shared —
 * mirroring `GeneralActionWithContext` (ADR 0153).
 */
export type AssetWithContext = Asset & {
  /** How many members a `shared` Asset is shared with; 0 for other scopes. */
  sharedWithCount: number;
  /** Selected member ids for a `shared` Asset; empty for other scopes. */
  sharedWithUserIds: string[];
  /** The household's name for a `shared`/`household` Asset, when one exists. */
  householdName: string | null;
};

/**
 * Owner-scoped Asset CRUD plus the scope-visibility read seam and the internal
 * Asset Audit trail (Phase 6 #197). Owner-keyed methods touch only the caller's
 * own assets; the `Visible` methods widen reads to any asset the caller may see
 * under the Phase 4 scope rules (private = owner; household = active members;
 * shared = owner + selected members). This store composes with a household store
 * so scope filtering and shares live behind one seam (AGENTS.md owner-scoped
 * seams; ADR 0153). Later Phase 6 slices (memories, evidence, links, search, Eve)
 * call this seam thinly rather than reaching for the tables.
 */
export type AssetStore = {
  createAsset: (input: CreateAssetInput) => Promise<Asset>;
  getAsset: (input: { ownerUserId: string; assetId: string }) => Promise<Asset | null>;
  /** Loads an asset the caller may see under scope rules, whoever owns it. */
  getVisibleAsset: (input: { callerUserId: string; assetId: string }) => Promise<Asset | null>;
  updateAsset: (input: {
    ownerUserId: string;
    assetId: string;
    patch: AssetPatch;
  }) => Promise<Asset>;
  /** Owner-keyed correction/privacy delete. Normal lifecycle cleanup uses archive. */
  deleteAsset: (input: { ownerUserId: string; assetId: string }) => Promise<boolean>;
  /**
   * Lists every asset the caller may see under scope rules, optionally narrowed
   * by kind, lifecycle status, and visibility scope. Scope filtering happens
   * here, pre-retrieval, so nothing out of scope ever reaches a surface. Ordering
   * contract both stores MUST honor: case-insensitive name ascending, then
   * most-recently-created as a stable tiebreak — a browsable ledger, not a feed.
   */
  listVisibleAssetsForCaller: (input: {
    callerUserId: string;
    kinds?: AssetKind[];
    statuses?: AssetStatus[];
    scopes?: PrivacyScope[];
    limit?: number;
    offset?: number;
  }) => Promise<Asset[]>;
  createAssetAuditEvent: (input: CreateAssetAuditEventInput) => Promise<AssetAuditEvent>;
  /** The append-only internal audit trail for one asset, oldest first. Owner-keyed. */
  listAssetAuditEvents: (input: {
    ownerUserId: string;
    assetId: string;
  }) => Promise<AssetAuditEvent[]>;
};

/**
 * The lifecycle store: Asset CRUD/audit plus the household scope/shares surface,
 * so a visibility scope can be verified and shares materialized before an Asset
 * is persisted (ADR 0153). Mirrors the General Action lifecycle-store composition
 * so all owner-scoped seams read alike.
 */
export type AssetLifecycleStore = AssetStore &
  Pick<
    HouseholdStore,
    | "getHouseholdWorkspace"
    | "getHouseholdMembership"
    | "listHouseholdMemberships"
    | "createHouseholdRecordShare"
    | "listHouseholdRecordShares"
    | "deleteHouseholdRecordShares"
  >;

export type AssetActionInput = {
  /** The acting user, not necessarily the owner. For a private asset this is the
   * owner; for a household or selected-shared one it may be any member who can see
   * it. Owner keying happens internally off the loaded record — this field only
   * names who is acting (ADR 0153). */
  actorUserId: string;
  assetId: string;
};

export type CreateActiveAssetInput = {
  ownerUserId: string;
  name: string;
  kind: AssetKind;
  // Visibility. Defaults to private, fail-closed (ADR 0153). A non-private scope
  // requires the owner's active household; `shared` also requires selected members.
  scope?: PrivacyScope;
  householdId?: string | null;
  selectedUserIds?: string[];
  /** Where this write originated, for the internal audit trail. Defaults to `user`. */
  source?: AssetAuditSource;
};

export type EditAssetInput = AssetActionInput & {
  edit: AssetEdit;
  source?: AssetAuditSource;
};

export type ListAssetsInput = {
  callerUserId: string;
  kinds?: AssetKind[];
  statuses?: AssetStatus[];
  scopes?: PrivacyScope[];
  limit?: number;
  offset?: number;
};

export type ListAssetAuditInput = {
  ownerUserId: string;
  assetId: string;
};
