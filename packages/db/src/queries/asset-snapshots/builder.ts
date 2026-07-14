import {
  type AssetSnapshot,
  type AssetSnapshotInputPack,
  collectAssetSnapshotReferences,
  computeAssetSnapshotFingerprint,
  generateDeterministicAssetSnapshot,
} from "@tendnote/domain";
import { createAssetActionLinks } from "../assets/action-links";
import { createAssetContextLinks } from "../assets/links";
import { loadAnchor } from "../assets/review-shared";
import type {
  AssetSnapshotContext,
  AssetSnapshotContextStore,
  AssetSnapshotGenerator,
  AssetSnapshotResult,
  GetAssetSnapshotInput,
} from "./types";

export type CreateAssetSnapshotOptions = {
  generator?: AssetSnapshotGenerator;
};

/** The empty context for an asset the caller cannot see — indistinguishable from absent. */
const EMPTY_CONTEXT: AssetSnapshotContext = {
  asset: null,
  memories: [],
  evidence: [],
  relatedAssets: [],
  personLinks: [],
  actions: [],
};

/** A failed snapshot is never fresh, so the next read retries the rebuild. */
function isSnapshotFresh(snapshot: AssetSnapshot, fingerprint: string): boolean {
  return !snapshot.failureReason && snapshot.inputFingerprint === fingerprint;
}

/**
 * The snapshot-backed Asset context read path (#196, #204). Both the Asset Profile and
 * Eve call this seam rather than assembling asset context themselves, so generation,
 * visibility filtering, freshness, and owner scoping stay in one place.
 *
 * The invariant this seam exists to protect: **a snapshot is a cache, never a source of
 * truth.** Three things enforce that structurally rather than by convention:
 *
 * - `context` — the live, visibility-filtered records — is *always* returned, whatever
 *   the snapshot's state. A consumer can therefore always ground a claim on real rows.
 * - Freshness is recomputed from those records on every read. There is no invalidation
 *   event to forget to fire; correcting a filter size flips the snapshot stale by itself.
 * - Everything after the live load is best-effort. A cache read, a generator call, or a
 *   persist that throws — including against an unmigrated database — degrades to
 *   `fallback` with the live context, and never breaks the profile or the assistant.
 */
export function createAssetSnapshot(
  store: AssetSnapshotContextStore,
  options: CreateAssetSnapshotOptions = {},
) {
  const contextLinks = createAssetContextLinks(store);
  const actionLinks = createAssetActionLinks(store);
  const generate = options.generator ?? generateDeterministicAssetSnapshot;

  return {
    async getAssetSnapshot(input: GetAssetSnapshotInput): Promise<AssetSnapshotResult> {
      const context = await loadContext(store, contextLinks, actionLinks, input);

      if (!context.asset) {
        return { status: "fallback", snapshot: null, context };
      }

      let existing: AssetSnapshot | null = null;
      try {
        // `ownerUserId` on the row is the caller whose view is cached — a household
        // asset holds one row per member who reads it, each built from that member's
        // own visibility-filtered pack, so the cache can never widen access.
        existing = await store.getAssetSnapshot({
          ownerUserId: input.callerUserId,
          assetId: input.assetId,
        });

        const pack: AssetSnapshotInputPack = {
          asset: context.asset,
          memories: context.memories,
          evidence: context.evidence,
          relatedAssets: context.relatedAssets,
          personLinks: context.personLinks,
          actions: context.actions,
        };
        const fingerprint = computeAssetSnapshotFingerprint(pack);

        if (existing && isSnapshotFresh(existing, fingerprint)) {
          return { status: "fresh", snapshot: existing, context };
        }

        const prose = await generate(pack);
        const snapshot = await store.upsertAssetSnapshot({
          ownerUserId: input.callerUserId,
          assetId: input.assetId,
          summary: prose.summary,
          // Citations are record-level and owned by the builder, never by the generator
          // or the model — so a snapshot's grounding cannot drift with its prose.
          supportingReferences: collectAssetSnapshotReferences(pack),
          generatorVersion: prose.generatorVersion,
          inputFingerprint: fingerprint,
          generatedAt: new Date(),
          failureReason: null,
        });

        return { status: "rebuilt", snapshot, context };
      } catch (error) {
        const failureReason =
          error instanceof Error ? error.message : "asset snapshot read or generation failed";
        const failed = await recordFailure(store, existing, input, failureReason);

        return { status: "fallback", snapshot: failed ?? existing, context };
      }
    },
  };
}

/**
 * Loads everything the caller may see about one Asset. Every record here has already
 * passed the caller's own visibility gate — a private memory under a household asset
 * simply is not in the pack, so it can never reach the prose, the citations, or the
 * fingerprint. Pending (suggested) related links are excluded: a proposal is not a fact
 * about the asset, and a cache must not quietly promote one.
 */
async function loadContext(
  store: AssetSnapshotContextStore,
  contextLinks: ReturnType<typeof createAssetContextLinks>,
  actionLinks: ReturnType<typeof createAssetActionLinks>,
  input: GetAssetSnapshotInput,
): Promise<AssetSnapshotContext> {
  const asset = await loadAnchor(store, input.callerUserId, input.assetId);
  if (!asset) {
    return EMPTY_CONTEXT;
  }

  const scoped = { callerUserId: input.callerUserId, assetId: input.assetId };
  const [memories, evidence, relatedLinks, personLinks, linkedActions] = await Promise.all([
    // Already narrowed to the caller's scope-visible *active* memories by the seam:
    // a suggested proposal is not a fact and never enters a snapshot.
    store.listVisibleAssetMemoriesForAsset(scoped),
    store.listVisibleAssetEvidenceForAsset(scoped),
    contextLinks.listRelatedAssetLinks(scoped),
    contextLinks.listAssetPersonLinks(scoped),
    actionLinks.listLinkedGeneralActionsForAsset(scoped),
  ]);

  return {
    asset,
    memories,
    evidence: evidence.map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      updatedAt: item.updatedAt,
    })),
    relatedAssets: relatedLinks
      .filter((link) => !link.pending)
      .map((link) => ({
        linkId: link.linkId,
        relation: link.relation,
        assetId: link.otherAsset.id,
        assetName: link.otherAsset.name,
      })),
    personLinks: personLinks.map((link) => ({
      linkId: link.linkId,
      relation: link.relation,
      personId: link.person.id,
      personName: link.person.displayName,
    })),
    actions: linkedActions.map((linked) => ({
      id: linked.action.id,
      title: linked.action.title,
      status: linked.action.status,
      // Day-precise, like every other asset date.
      dueAt: linked.action.dueAt ? linked.action.dueAt.toISOString().slice(0, 10) : null,
      updatedAt: linked.action.updatedAt,
    })),
  };
}

/**
 * Best-effort failure marker. Preserves the prior snapshot's prose and its (now stale)
 * fingerprint so the next read retries the rebuild, while recording why generation
 * failed. A write failure here must not break the fail-open path, so it is swallowed.
 */
async function recordFailure(
  store: AssetSnapshotContextStore,
  existing: AssetSnapshot | null,
  input: GetAssetSnapshotInput,
  failureReason: string,
): Promise<AssetSnapshot | null> {
  if (!existing) {
    return null;
  }

  try {
    return await store.upsertAssetSnapshot({
      ownerUserId: input.callerUserId,
      assetId: input.assetId,
      summary: existing.summary,
      supportingReferences: existing.supportingReferences,
      generatorVersion: existing.generatorVersion,
      inputFingerprint: existing.inputFingerprint,
      generatedAt: new Date(),
      failureReason,
    });
  } catch {
    return null;
  }
}
