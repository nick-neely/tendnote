import type {
  Asset,
  AssetAuditSource,
  AssetLink,
  AssetLinkRelation,
  AssetPersonLink,
  AssetPersonRelation,
  CreateAssetLinkInput,
  CreateAssetPersonLinkInput,
} from "@tendnote/domain";
import type { SourceRecordResolutionStore } from "../source-records/types";
import type { AssetReviewLifecycleStore } from "./review-types";

/** Bounded patch the link layer may apply to a persisted Related Asset Link. */
export type AssetLinkPatch = Partial<Pick<AssetLink, "status">>;

/**
 * Related Asset Link + Asset Person Link rows (#202). The `list*ForAsset` reads
 * return raw rows — per-record visibility filtering of every side happens in the
 * query layer (`links.ts`), the only surface-facing reader. Both unique triples
 * are owner-scoped, so idempotent creation can only ever return the creator's
 * own row — no write path can reach a co-member's link or its review state.
 * Ordering contract for both lists: oldest first, id as tiebreak — a stable
 * ledger, both stores alike.
 */
export type AssetLinkStore = {
  /** Idempotent on the owner-scoped (owner, from, to, relation) triple. */
  createAssetLink: (input: CreateAssetLinkInput) => Promise<AssetLink>;
  getAssetLink: (input: { ownerUserId: string; linkId: string }) => Promise<AssetLink | null>;
  updateAssetLink: (input: {
    ownerUserId: string;
    linkId: string;
    patch: AssetLinkPatch;
  }) => Promise<AssetLink>;
  /** Owner-keyed hard delete. */
  deleteAssetLink: (input: { ownerUserId: string; linkId: string }) => Promise<void>;
  /** Every link row touching the asset, both directions. */
  listAssetLinksForAsset: (input: { assetId: string }) => Promise<AssetLink[]>;
  /** Idempotent on the owner-scoped (owner, asset, person, relation) triple. */
  createAssetPersonLink: (input: CreateAssetPersonLinkInput) => Promise<AssetPersonLink>;
  getAssetPersonLink: (input: {
    ownerUserId: string;
    linkId: string;
  }) => Promise<AssetPersonLink | null>;
  /** Owner-keyed hard delete. */
  deleteAssetPersonLink: (input: { ownerUserId: string; linkId: string }) => Promise<void>;
  listAssetPersonLinksForAsset: (input: { assetId: string }) => Promise<AssetPersonLink[]>;
};

/**
 * Everything the profile-context link seam composes over (#202): the asset
 * review lifecycle store (assets, audit, grounding, households) plus the link
 * rows and the owner-keyed person read that verifies and names a person link's
 * person.
 */
export type AssetContextLinkStore = AssetReviewLifecycleStore &
  AssetLinkStore &
  Pick<SourceRecordResolutionStore, "getPerson">;

export type AddAssetLinkInput = {
  /** Linking is an explicit authoring act by whoever can see both assets. */
  actorUserId: string;
  fromAssetId: string;
  toAssetId: string;
  relation: AssetLinkRelation;
  source?: AssetAuditSource;
};

/**
 * Proposes an inferred Related Asset Link for review (#202): the link is
 * persisted `suggested` — owner-only, absent from every profile but the
 * owner's pending strip — until review accepts or dismisses it. Grounding is
 * mandatory: an inference must come from somewhere (ADR 0151).
 */
export type SuggestAssetLinkInput = {
  ownerUserId: string;
  fromAssetId: string;
  toAssetId: string;
  relation: AssetLinkRelation;
  sourceRecordId: string;
  directlyRequested?: boolean;
  source?: AssetAuditSource;
};

export type AssetLinkActionInput = {
  /** Link review and removal are owner-only: the link belongs to whoever created it. */
  actorUserId: string;
  linkId: string;
  source?: AssetAuditSource;
};

/** A Related Asset Link hydrated for one profile's read, perspective resolved. */
export type RelatedAssetLink = {
  linkId: string;
  relation: AssetLinkRelation;
  /** Which end the profile reads the link from: subject (outgoing) or object (incoming). */
  direction: "outgoing" | "incoming";
  /** The asset on the other end, loaded under the caller's own scope rules. */
  otherAsset: Asset;
  /** True while the link is a pending suggestion (owner-only). */
  pending: boolean;
  /** Whether the caller owns this link, so surfaces can offer remove/review. */
  owned: boolean;
  /** When the link was made — the moment Asset History retells (#202). */
  createdAt: Date;
};

export type AddAssetPersonLinkInput = {
  /** The acting caller; the link is created under their key — people are theirs alone. */
  actorUserId: string;
  assetId: string;
  personId: string;
  relation: AssetPersonRelation;
  source?: AssetAuditSource;
};

/** An Asset Person Link hydrated for one profile's read. */
export type AssetPersonLinkEntry = {
  linkId: string;
  relation: AssetPersonRelation;
  person: { id: string; displayName: string };
  /** When the link was made — the moment Asset History retells (#202). */
  createdAt: Date;
};

export type ListAssetContextInput = {
  callerUserId: string;
  assetId: string;
};
