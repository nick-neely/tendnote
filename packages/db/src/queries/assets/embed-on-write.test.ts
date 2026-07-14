import { describe, expect, it } from "vitest";
import { seedSourceRecord } from "./asset-test-fixtures";
import type { AssetEmbeddingScheduler } from "./embed";
import { createInMemoryAssetReviewLifecycleStore } from "./in-memory-review-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAssetReview } from "./review";

type Store = ReturnType<typeof createInMemoryAssetReviewLifecycleStore>;

const OWNER = "user-1";

function setup(options: { failing?: boolean } = {}) {
  const enqueued: Array<{ recordKind: string; recordId: string; ownerUserId: string }> = [];
  const scheduleAssetEmbedding: AssetEmbeddingScheduler = async (input) => {
    if (options.failing) {
      throw new Error("embedding queue unavailable");
    }
    enqueued.push(input);

    return undefined;
  };

  const store = createInMemoryAssetReviewLifecycleStore();
  const lifecycle = createAssetLifecycle(store, { scheduleAssetEmbedding });
  const review = createAssetReview(store, { scheduleAssetEmbedding });

  const kindsFor = (recordKind: string) =>
    enqueued.filter((job) => job.recordKind === recordKind).map((job) => job.recordId);

  return { store, lifecycle, review, enqueued, kindsFor };
}

async function seedAsset(lifecycle: ReturnType<typeof createAssetLifecycle>) {
  return lifecycle.createAsset({ ownerUserId: OWNER, name: "Refrigerator", kind: "appliance" });
}

describe("asset embed-on-write", () => {
  it("enqueues an embedding when an asset is created", async () => {
    const { lifecycle, kindsFor } = setup();

    const asset = await seedAsset(lifecycle);

    expect(kindsFor("asset")).toEqual([asset.id]);
  });

  it("re-embeds a renamed asset — the vector follows the record", async () => {
    const { lifecycle, kindsFor } = setup();
    const asset = await seedAsset(lifecycle);

    await lifecycle.editAsset({
      actorUserId: OWNER,
      assetId: asset.id,
      edit: { name: "Kitchen refrigerator" },
    });

    expect(kindsFor("asset")).toEqual([asset.id, asset.id]);
  });

  it("re-embeds on archive and restore, so a proposal's retrievability follows its status", async () => {
    const { lifecycle, kindsFor } = setup();
    const asset = await seedAsset(lifecycle);

    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id });
    await lifecycle.restoreAsset({ actorUserId: OWNER, assetId: asset.id });

    expect(kindsFor("asset")).toHaveLength(3);
  });

  it("enqueues an embedding when an active memory is created", async () => {
    const { lifecycle, review, kindsFor } = setup();
    const asset = await seedAsset(lifecycle);

    const memory = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Filter size",
      value: { type: "text", text: "RPWFE" },
    });

    expect(kindsFor("asset_memory")).toEqual([memory.id]);
  });

  it("never fails the write when the embedding queue is down — a lost vector must not cost a fact", async () => {
    const { lifecycle, review } = setup({ failing: true });

    const asset = await seedAsset(lifecycle);
    const memory = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Filter size",
      value: { type: "text", text: "RPWFE" },
    });

    // Both writes landed despite every embed job throwing.
    expect(asset.id).toBeTruthy();
    expect(memory.value).toEqual({ type: "text", text: "RPWFE" });
  });

  it("does nothing when no scheduler is wired", async () => {
    const store = createInMemoryAssetReviewLifecycleStore();
    const lifecycle = createAssetLifecycle(store);

    await expect(seedAsset(lifecycle)).resolves.toBeTruthy();
  });
});

/**
 * Batch review — the Review Queue's "accept all", and the path the promoted refrigerator water
 * filter actually takes (#198, #204).
 *
 * These are regression tests for a bug that shipped with #198 and survived every unit suite, three
 * code reviews, and a design audit: the batch steps called the *unwrapped* module functions, so
 * they skipped the embed-on-write the single-record accepts perform. The embedding processor
 * deliberately drops anything enqueued under a non-durable anchor, so acceptance is the only
 * moment these records can become retrievable — and the batch path let that moment pass in
 * silence. Assets and facts accepted through the review queue were on the profile, in exact
 * recall, and completely absent from semantic search. Keyword recall is what hid it: the answers
 * still *looked* right.
 */
describe("asset embed-on-write — batch review", () => {
  async function seedProposal(review: ReturnType<typeof createAssetReview>, store: Store) {
    const source = await seedSourceRecord(store, OWNER);
    const { group } = await review.suggestAsset({
      ownerUserId: OWNER,
      name: "Kitchen refrigerator",
      kind: "appliance",
      sourceRecordId: source.id,
      memories: [
        { label: "Filter size", value: { type: "text", text: "EDR1RXD1" } },
        { label: "Model number", value: { type: "text", text: "WRF535SWHZ" } },
      ],
    });
    return { groupId: group.id, sourceId: source.id };
  }

  it("embeds the anchor and every memory accepted in one batch", async () => {
    const { store, review, kindsFor } = setup();
    const { groupId } = await seedProposal(review, store);

    const accepted = await review.acceptAssetReviewGroup({ actorUserId: OWNER, groupId });
    const memories = await review.listAssetMemories({
      callerUserId: OWNER,
      assetId: accepted.asset.id,
    });

    // The asset is durable for the first time…
    expect(kindsFor("asset")).toEqual([accepted.asset.id]);
    // …and every fact accepted with it is enqueued, because everything enqueued while the anchor
    // was still a proposal was discarded by the processor as un-anchored.
    expect(kindsFor("asset_memory")).toEqual(
      expect.arrayContaining(memories.map((memory) => memory.id)),
    );
    for (const memory of memories) {
      expect(kindsFor("asset_memory")).toContain(memory.id);
    }
  });

  it("re-enqueues a batch-dismissed proposal, so the processor drops whatever it holds", async () => {
    const { store, review, kindsFor } = setup();
    const { groupId } = await seedProposal(review, store);
    const group = await review.getAssetReviewGroup({ actorUserId: OWNER, groupId });

    await review.dismissAssetReviewGroup({ actorUserId: OWNER, groupId });

    // The husk and every detail it cascaded. Nothing under a suggested anchor is embedded today,
    // which is exactly why this must not depend on that: "correct only because of another bug" is
    // a fuse, not a guarantee.
    expect(kindsFor("asset")).toContain(group?.asset.id);
    for (const memory of group?.memories ?? []) {
      expect(kindsFor("asset_memory")).toContain(memory.id);
    }
  });

  it("embeds details a batch dismiss sets aside on an asset the user already has", async () => {
    const { store, lifecycle, review, kindsFor } = setup();
    const asset = await seedAsset(lifecycle);
    const source = await seedSourceRecord(store, OWNER);

    // Suggestions on a DURABLE anchor are embedded when proposed (owner-only review search), so
    // setting them aside must let the vector go — a rejected guess that stays retrievable is a
    // fact the user believes they deleted.
    const group = await review.suggestAssetMemories({
      ownerUserId: OWNER,
      assetId: asset.id,
      sourceRecordId: source.id,
      memories: [{ label: "Serial", value: { type: "text", text: "C02X1234" } }],
    });
    const suggested = group.memories[0] as (typeof group.memories)[number];
    expect(kindsFor("asset_memory")).toEqual([suggested.id]);

    await review.dismissAssetReviewGroup({ actorUserId: OWNER, groupId: group.group.id });

    expect(kindsFor("asset_memory")).toEqual([suggested.id, suggested.id]);
  });

  it("embeds details that duplicate review re-anchors onto an existing asset", async () => {
    const { store, lifecycle, review, kindsFor } = setup();
    const existing = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Kitchen refrigerator",
      kind: "appliance",
    });
    const { groupId } = await seedProposal(review, store);
    const proposal = await review.getAssetReviewGroup({ actorUserId: OWNER, groupId });

    await review.linkAssetReviewGroup({
      actorUserId: OWNER,
      groupId,
      targetAssetId: existing.id,
    });

    // Linking moves still-pending details onto an anchor that is already durable — the same state
    // change acceptance makes, and the first moment they can be embedded at all.
    for (const memory of proposal?.memories ?? []) {
      expect(kindsFor("asset_memory")).toContain(memory.id);
    }
  });
});
