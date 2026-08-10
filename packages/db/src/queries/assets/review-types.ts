import type {
  Asset,
  AssetAuditSource,
  AssetEdit,
  AssetEvidence,
  AssetMemory,
  AssetMemoryEdit,
  AssetMemoryScope,
  AssetMemoryStatus,
  AssetMemoryValue,
  AssetOwnership,
  AssetReviewGroup,
  CreateAssetMemoryInput,
  CreateAssetReviewGroupInput,
  CreateGeneralActionAssetLinkInput,
  GeneralActionAssetLink,
  PrivacyScope,
  SourceRecord,
} from "@tendnote/domain";
import type { SourceRecordResolutionStore } from "../source-records/types";
import type { AssetEvidenceStore } from "./evidence-types";
import type { AssetLifecycleStore } from "./types";

/** Bounded patch the review layer may apply to a persisted Asset Memory. */
export type AssetMemoryPatch = Partial<
  Pick<
    AssetMemory,
    "assetId" | "status" | "label" | "value" | "notes" | "scope" | "householdId" | "lastActorUserId"
  >
>;

/**
 * Owner-scoped Asset Memory + Asset Review Group storage (#198). Every method is
 * owner-keyed except `listVisibleAssetMemoriesForAsset`, which widens to the
 * caller's scope-visible *active* memories — per-record filtering, so a household
 * Asset can hold a private detail its members never see. Later slices (#199
 * evidence, #200 actions/Eve) extend this seam additively rather than reaching
 * for the tables.
 */
export type AssetReviewStore = {
  createAssetMemory: (input: CreateAssetMemoryInput) => Promise<AssetMemory>;
  getAssetMemory: (input: { ownerUserId: string; memoryId: string }) => Promise<AssetMemory | null>;
  /**
   * Loads one *active* memory the caller may see under per-record scope rules,
   * whoever owns it — the counterpart of `getVisibleAssetEvidence`, and how a
   * member reaches a household-native detail they did not write (#386).
   *
   * `includeSetAside` widens it to a `dismissed` detail as well, for the undo
   * behind set-aside: a household-native detail's owner-keyed read is refused by
   * the storage-key rule, so without this nobody — including the member who set
   * it aside — could bring the household's detail back. Deliberately a boolean
   * naming the one extra state rather than a status list: `suggested` is review
   * state and must never be scope-visible, and a list-shaped argument would make
   * that a caller's decision to get wrong.
   */
  getVisibleAssetMemory: (input: {
    callerUserId: string;
    memoryId: string;
    includeSetAside?: boolean;
  }) => Promise<AssetMemory | null>;
  updateAssetMemory: (input: {
    ownerUserId: string;
    memoryId: string;
    patch: AssetMemoryPatch;
  }) => Promise<AssetMemory>;
  /**
   * The owner's memories, optionally narrowed by asset, review group, and status.
   * Ordering contract both stores MUST honor: oldest first (a stable ledger of
   * facts), id as tiebreak.
   */
  listAssetMemoriesForOwner: (input: {
    ownerUserId: string;
    assetId?: string;
    reviewGroupId?: string;
    statuses?: AssetMemoryStatus[];
  }) => Promise<AssetMemory[]>;
  /**
   * The *active* memories on one asset the caller may see under per-record scope
   * rules (private = owner; household = active members). Suggested/dismissed
   * memories never surface here — review is owner-only. Same ordering contract.
   */
  listVisibleAssetMemoriesForAsset: (input: {
    callerUserId: string;
    assetId: string;
  }) => Promise<AssetMemory[]>;
  createAssetReviewGroup: (input: CreateAssetReviewGroupInput) => Promise<AssetReviewGroup>;
  getAssetReviewGroup: (input: {
    ownerUserId: string;
    groupId: string;
  }) => Promise<AssetReviewGroup | null>;
  /** The pending group anchored to an asset, for idempotent accept re-reads. */
  getAssetReviewGroupByAsset: (input: {
    ownerUserId: string;
    assetId: string;
  }) => Promise<AssetReviewGroup | null>;
  /** Re-points a group's anchor when duplicate review links to an existing Asset. */
  updateAssetReviewGroupAsset: (input: {
    ownerUserId: string;
    groupId: string;
    assetId: string;
  }) => Promise<AssetReviewGroup>;
  /**
   * The owner's review groups that still have at least one pending member — a
   * `suggested` anchor asset or a `suggested` memory — newest first. Resolved
   * groups drop out of the queue; their records keep the group id for provenance.
   */
  listPendingAssetReviewGroupsForOwner: (input: {
    ownerUserId: string;
    limit?: number;
  }) => Promise<AssetReviewGroup[]>;
};

/**
 * General Action ↔ Asset link rows (#199): the durable bridge an asset hint
 * grows into. The two `list*` reads return raw rows — per-record visibility
 * filtering of both sides happens in the query layer (`action-links.ts`), which
 * is the only surface-facing reader; nothing here reaches a surface directly.
 * Ordering contract for both lists: oldest first, id as tiebreak.
 */
export type GeneralActionAssetLinkStore = {
  /** Idempotent on (generalActionId, assetId): re-linking returns the existing row. */
  createGeneralActionAssetLink: (
    input: CreateGeneralActionAssetLinkInput,
  ) => Promise<GeneralActionAssetLink>;
  listGeneralActionAssetLinksForActions: (input: {
    generalActionIds: string[];
  }) => Promise<GeneralActionAssetLink[]>;
  listGeneralActionAssetLinksForAsset: (input: {
    assetId: string;
  }) => Promise<GeneralActionAssetLink[]>;
  /**
   * Re-points the owner's links from a would-be duplicate onto the link target
   * during duplicate review (#199). A row that would collide with an existing
   * (action, target) pair is deleted instead — the link already exists. Returns
   * how many rows now point at the target.
   */
  repointGeneralActionAssetLinks: (input: {
    ownerUserId: string;
    fromAssetId: string;
    toAssetId: string;
  }) => Promise<number>;
  /** Owner-keyed hard delete, for clearing a stale link to a dismissed husk. */
  deleteGeneralActionAssetLink: (input: { ownerUserId: string; linkId: string }) => Promise<void>;
};

/**
 * Everything the review lifecycle composes over: Asset CRUD/audit/visibility +
 * households (via the lifecycle store), the memory/group store, the evidence
 * store (#200), action links (#199), and source-record grounding lookups (ADR
 * 0151).
 */
export type AssetReviewLifecycleStore = AssetLifecycleStore &
  AssetReviewStore &
  AssetEvidenceStore &
  GeneralActionAssetLinkStore &
  Pick<SourceRecordResolutionStore, "getSourceRecord">;

/** One proposed memory riding a suggestion call: the reviewable content. */
export type SuggestAssetMemoryContent = {
  label: string;
  value?: AssetMemoryValue | null;
  notes?: string | null;
  /** Defaults to the anchor's scope where supported (household), else private. */
  scope?: AssetMemoryScope;
  /** Required when choosing a selected-member audience under a household Asset. */
  selectedUserIds?: string[];
};

/**
 * Proposes a Suggested Asset (with optional Suggested Asset Memories) from one
 * source context, opening an Asset Review Group in the shared Review Queue. The
 * asset row is persisted `suggested` — owner-only, absent from every surface —
 * until review accepts it, links it to an existing Asset, or dismisses it.
 */
export type SuggestAssetInput = {
  ownerUserId: string;
  name: string;
  kind: Asset["kind"];
  // Visibility the proposal argues for. Suggested rows remain owner-only until
  // acceptance; selected shares become effective only when that same row is promoted.
  scope?: PrivacyScope;
  householdId?: string | null;
  selectedUserIds?: string[];
  // Grounding is mandatory: a suggestion must come from somewhere (ADR 0151).
  sourceRecordId: string;
  // Restricted source records don't feed proactive suggestions unless the user
  // asked directly (ADR 0058).
  directlyRequested?: boolean;
  memories?: SuggestAssetMemoryContent[];
  source?: AssetAuditSource;
};

/**
 * Proposes Suggested Asset Memories for an Asset the owner already has (or can
 * see), opening a review group anchored to that existing asset — no duplicate
 * asset row, no duplicate prompt.
 */
export type SuggestAssetMemoriesInput = {
  ownerUserId: string;
  assetId: string;
  sourceRecordId: string;
  directlyRequested?: boolean;
  memories: SuggestAssetMemoryContent[];
  source?: AssetAuditSource;
};

/** Creates a durable, active Asset Memory from explicit user intent (#196). */
export type CreateActiveAssetMemoryInput = {
  ownerUserId: string;
  assetId: string;
  label: string;
  value?: AssetMemoryValue | null;
  notes?: string | null;
  scope?: AssetMemoryScope;
  /**
   * Defaults to `member_owned`. `household_native` makes the detail the
   * workspace's — whole-household-visible whatever `scope` says, correctable by
   * any active member, and it stays when its author leaves. Only allowed under a
   * household-native Asset (#386).
   */
  ownership?: AssetOwnership;
  /** Required when choosing a selected-member audience under a household Asset. */
  selectedUserIds?: string[];
  sourceRecordId?: string | null;
  source?: AssetAuditSource;
};

export type AssetMemoryActionInput = {
  /** Review is owner-only: proposals belong to their owner until accepted. */
  actorUserId: string;
  memoryId: string;
};

/**
 * Corrects a durable, active Asset Memory in place (#386).
 *
 * Distinct from the review edits above, which correct a *proposal* before it
 * becomes truth and are owner-only by construction. This one is the "correct"
 * half of maintaining a detail that is already true, so it asks the proof: the
 * owner of a member-owned detail, any active member of a household-native one.
 */
export type EditAssetMemoryInput = AssetMemoryActionInput & {
  edit: AssetMemoryEdit;
  /** The revision the editor's draft was written against; see `EditAssetInput`. */
  expectedRevision?: number | null;
  source?: AssetAuditSource;
};

export type AcceptSuggestedAssetMemoryInput = AssetMemoryActionInput & {
  edit?: AssetMemoryEdit;
  source?: AssetAuditSource;
};

export type EditSuggestedAssetMemoryInput = AssetMemoryActionInput & {
  edit: AssetMemoryEdit;
  source?: AssetAuditSource;
};

export type SuggestedAssetActionInput = {
  actorUserId: string;
  assetId: string;
  source?: AssetAuditSource;
};

export type AcceptSuggestedAssetInput = SuggestedAssetActionInput & {
  edit?: AssetEdit;
  // Optional final audience — including the selected-shared one a bare proposal
  // cannot carry. Absent keeps the scope the proposal argued for.
  scope?: PrivacyScope;
  householdId?: string | null;
  selectedUserIds?: string[];
};

export type EditSuggestedAssetInput = SuggestedAssetActionInput & {
  edit: AssetEdit;
};

export type AssetReviewGroupActionInput = {
  actorUserId: string;
  groupId: string;
  source?: AssetAuditSource;
};

/** Resolves duplicate review by linking the group to an existing Asset. */
export type LinkAssetReviewGroupInput = AssetReviewGroupActionInput & {
  targetAssetId: string;
};

export type ListAssetReviewGroupsInput = {
  ownerUserId: string;
  limit?: number;
};

/**
 * Fixed typed component for an Asset Review Group item, referencing persisted ids
 * only (ADR 0028) so review surfaces reload authoritative records before acting.
 */
export type AssetReviewGroupComponent = {
  type: "asset_review_group";
  groupId: string;
  assetId: string;
  sourceRecordId: string | null;
};

/**
 * An Asset Review Group presented for review: the anchor asset (a pending
 * Suggested Asset, or the existing/linked Asset gaining details), the pending
 * Suggested Asset Memories, the deterministic duplicate-review candidates for a
 * pending anchor, and the grounding source record (#198).
 */
export type AssetReviewGroupResult = {
  group: AssetReviewGroup;
  /** The group's anchor asset. Never null — a group cannot outlive its anchor. */
  asset: Asset;
  /** Whether the anchor is itself still a pending Suggested Asset. */
  assetPending: boolean;
  /** The group's still-pending Suggested Asset Memories, oldest first. */
  memories: AssetMemory[];
  /** The Asset Evidence captured into this group, oldest first (#200). */
  evidence: AssetEvidence[];
  /** Existing Assets the pending anchor likely duplicates; empty once resolved. */
  duplicateCandidates: Asset[];
  sourceRecord: SourceRecord | null;
  component: AssetReviewGroupComponent;
};
