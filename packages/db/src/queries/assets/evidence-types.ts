import type {
  AssetAuditSource,
  AssetChildScope,
  AssetEvidence,
  AssetEvidenceKind,
  AssetEvidenceMoney,
  AssetKind,
  CreateAssetEvidenceInput,
} from "@tendnote/domain";

/** Bounded patch the evidence layer may apply to persisted Asset Evidence:
 * re-anchoring and visibility only — evidence content is immutable (#200). */
export type AssetEvidencePatch = Partial<
  Pick<AssetEvidence, "assetId" | "scope" | "householdId" | "reviewGroupId" | "lastActorUserId">
>;

/**
 * An evidence upload's bytes with their metadata — one shape both ways: riding
 * an evidence write in, and coming back out of the gated file read.
 */
export type AssetEvidenceFilePayload = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
};

/**
 * Owner-scoped Asset Evidence storage (#200). Every method is owner-keyed except
 * the `Visible` reads, which widen to the caller's per-record scope — and only
 * under a *durable* anchor asset, so evidence riding a still-pending Asset Review
 * Group never reaches a member before review resolves. Bytes live behind
 * `getAssetEvidenceFileBytes`, keyed by evidence id, and are only reachable
 * through the review seam's gated file read — metadata reads never touch them.
 */
export type AssetEvidenceStore = {
  /** Persists evidence and, atomically, its uploaded bytes when present. */
  createAssetEvidence: (input: {
    values: CreateAssetEvidenceInput;
    fileBytes?: Uint8Array;
  }) => Promise<AssetEvidence>;
  getAssetEvidence: (input: {
    ownerUserId: string;
    evidenceId: string;
  }) => Promise<AssetEvidence | null>;
  /** Loads evidence the caller may see under per-record scope + durable anchor. */
  getVisibleAssetEvidence: (input: {
    callerUserId: string;
    evidenceId: string;
  }) => Promise<AssetEvidence | null>;
  updateAssetEvidence: (input: {
    ownerUserId: string;
    evidenceId: string;
    patch: AssetEvidencePatch;
  }) => Promise<AssetEvidence>;
  /** Deletes evidence and its stored bytes together. */
  deleteAssetEvidence: (input: { ownerUserId: string; evidenceId: string }) => Promise<void>;
  /**
   * The owner's evidence, optionally narrowed by asset and review group.
   * Ordering contract both stores MUST honor: oldest first (a stable ledger),
   * id as tiebreak.
   */
  listAssetEvidenceForOwner: (input: {
    ownerUserId: string;
    assetId?: string;
    reviewGroupId?: string;
  }) => Promise<AssetEvidence[]>;
  /**
   * The evidence on one asset the caller may see: per-record scope filtering
   * (private = owner; household = active members) under a durable anchor only —
   * review-pending context stays its owner's. Same ordering contract.
   */
  listVisibleAssetEvidenceForAsset: (input: {
    callerUserId: string;
    assetId: string;
  }) => Promise<AssetEvidence[]>;
  /** Raw stored bytes for one evidence row; visibility is gated by the seam. */
  getAssetEvidenceFileBytes: (input: { evidenceId: string }) => Promise<Uint8Array | null>;
};

/**
 * Captures one piece of Asset Evidence (#200): to an existing Asset directly, or
 * to an Asset Review Group while its destination is still under review — exactly
 * one of the two targets. The shared entry point every capture surface (profile
 * drop zone, mobile capture, review card, and later Eve's plus-menu #201) routes
 * through, so chat never grows a separate attachment system.
 */
export type AddAssetEvidenceInput = {
  ownerUserId: string;
  /** Attach to this existing, active Asset… */
  assetId?: string;
  /** …or to this still-open Asset Review Group's anchor. */
  reviewGroupId?: string;
  kind: AssetEvidenceKind;
  label: string;
  file?: AssetEvidenceFilePayload;
  url?: string | null;
  capturedText?: string | null;
  money?: AssetEvidenceMoney | null;
  purchasedOn?: string | null;
  renewsOn?: string | null;
  /** Defaults to the anchor's scope where supported (household), else private. */
  scope?: AssetChildScope;
  /** Required when choosing a selected-member audience under a household Asset. */
  selectedUserIds?: string[];
  sourceRecordId?: string | null;
  source?: AssetAuditSource;
};

/**
 * Captures one piece of Asset Evidence to a *new* destination (#201): the user
 * named a thing Tendnote doesn't track yet, so the capture opens a review-gated
 * Suggested Asset proposal and the evidence rides its Asset Review Group. The
 * proposal argues private visibility; a wider audience is chosen at acceptance,
 * exactly as other Suggested Assets resolve. Explicit user intent (the user
 * typed the name) is the provenance, so the group records a null source —
 * paralleling the action-hint promotion bridge (#199).
 */
export type AddAssetEvidenceToNewAssetInput = Omit<
  AddAssetEvidenceInput,
  "assetId" | "reviewGroupId" | "scope"
> & {
  asset: { name: string; kind: AssetKind };
};

export type RemoveAssetEvidenceInput = {
  /** Evidence belongs to its owner: removal never widens to co-members. */
  actorUserId: string;
  evidenceId: string;
  source?: AssetAuditSource;
};
