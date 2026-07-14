import { describe, expect, it } from "vitest";
import type { AssetEmbeddingScheduler } from "./embed";
import { createInMemoryAssetReviewLifecycleStore } from "./in-memory-review-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAssetReview } from "./review";

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
