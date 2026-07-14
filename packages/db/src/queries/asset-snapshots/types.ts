import type {
  Asset,
  AssetMemory,
  AssetSnapshot,
  AssetSnapshotAction,
  AssetSnapshotEvidence,
  AssetSnapshotInputPack,
  AssetSnapshotPersonLink,
  AssetSnapshotProse,
  AssetSnapshotRelatedAsset,
  CreateAssetSnapshotInput,
} from "@tendnote/domain";
import type { AssetContextLinkStore } from "../assets/link-types";
import type { GeneralActionStore } from "../general-actions/types";

/**
 * Owner-scoped persistence for the Asset Snapshot cache. Deliberately two methods:
 * a snapshot is one current row per (caller, asset), so there is nothing to list,
 * page, or expire — a stale row is simply overwritten on the next read.
 *
 * `ownerUserId` here is the *caller* whose view is cached. A household asset yields
 * one snapshot row per member who reads it, each built from that member's own
 * visibility-filtered pack — so the cache can never widen what someone may see.
 */
export type AssetSnapshotStore = {
  getAssetSnapshot: (input: {
    ownerUserId: string;
    assetId: string;
  }) => Promise<AssetSnapshot | null>;
  upsertAssetSnapshot: (input: CreateAssetSnapshotInput) => Promise<AssetSnapshot>;
};

/**
 * Everything the snapshot read path depends on: the Asset context seams (asset,
 * memories, evidence, related links, person links) plus linked General Actions and
 * the snapshot cache itself.
 */
export type AssetSnapshotContextStore = AssetContextLinkStore &
  Pick<GeneralActionStore, "getGeneralAction" | "getVisibleGeneralAction"> &
  AssetSnapshotStore;

/**
 * The live, visibility-filtered records a snapshot was built from — always returned
 * alongside the snapshot, so consumers ground on source records rather than on
 * generated prose. This is what makes a stale or missing snapshot a non-event:
 * the Asset Profile and Eve still have the truth.
 */
export type AssetSnapshotContext = {
  asset: Asset | null;
  memories: AssetMemory[];
  evidence: AssetSnapshotEvidence[];
  relatedAssets: AssetSnapshotRelatedAsset[];
  personLinks: AssetSnapshotPersonLink[];
  actions: AssetSnapshotAction[];
};

/**
 * How the snapshot in a read result was produced:
 * - `fresh`    — an existing snapshot whose inputs were unchanged was reused;
 * - `rebuilt`  — a missing or stale snapshot was regenerated and persisted;
 * - `fallback` — no usable snapshot (unknown/invisible asset, or generation failed),
 *   so consumers must ground on `context`.
 */
export type AssetSnapshotReadStatus = "fresh" | "rebuilt" | "fallback";

export type AssetSnapshotResult = {
  status: AssetSnapshotReadStatus;
  snapshot: AssetSnapshot | null;
  context: AssetSnapshotContext;
};

export type GetAssetSnapshotInput = {
  callerUserId: string;
  assetId: string;
};

/**
 * A generator turns the trusted pack into prose plus the version tag identifying what
 * produced it. Injectable so the deterministic generator (the default) can be swapped
 * for an LLM adapter without touching freshness, citations, policy, or scoping. The
 * generator owns wording only.
 */
export type AssetSnapshotGenerator = (
  input: AssetSnapshotInputPack,
) => AssetSnapshotProse | Promise<AssetSnapshotProse>;

export type InMemoryAssetSnapshotStore = AssetSnapshotStore & {
  listAssetSnapshots: (input: { ownerUserId: string }) => Promise<AssetSnapshot[]>;
};
