import { DETERMINISTIC_ASSET_SNAPSHOT_GENERATOR_VERSION } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { seedOwnerMemberHousehold } from "../assets/asset-test-fixtures";
import { createInMemoryAssetActionLinkStore } from "../assets/in-memory-action-link-store";
import { createAssetLifecycle } from "../assets/lifecycle";
import { createAssetReview } from "../assets/review";
import { createAssetSnapshot } from "./builder";
import { createInMemoryAssetSnapshotStore } from "./in-memory-store";
import type { AssetSnapshotContextStore, AssetSnapshotGenerator } from "./types";

const OWNER = "user-1";
const MEMBER = "user-member";

function setup(options: { generator?: AssetSnapshotGenerator } = {}) {
  const store = {
    ...createInMemoryAssetActionLinkStore(),
    ...createInMemoryAssetSnapshotStore(),
  } satisfies AssetSnapshotContextStore;

  const lifecycle = createAssetLifecycle(store);
  const review = createAssetReview(store);
  const snapshots = createAssetSnapshot(store, options);

  async function seedAsset(overrides: Record<string, unknown> = {}) {
    return lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator",
      kind: "appliance",
      ...overrides,
    });
  }

  async function addMemory(assetId: string, overrides: Record<string, unknown> = {}) {
    return review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId,
      label: "Filter size",
      value: { type: "text", text: "RPWFE" },
      ...overrides,
    });
  }

  return { store, lifecycle, review, snapshots, seedAsset, addMemory };
}

describe("Asset Snapshot — rebuildable cache", () => {
  it("builds a snapshot on first read and cites the records it stands on", async () => {
    const { snapshots, seedAsset, addMemory } = setup();
    const asset = await seedAsset();
    const memory = await addMemory(asset.id);

    const result = await snapshots.getAssetSnapshot({
      callerUserId: OWNER,
      assetId: asset.id,
    });

    expect(result.status).toBe("rebuilt");
    expect(result.snapshot?.summary).toContain("Filter size: RPWFE");
    expect(result.snapshot?.generatorVersion).toBe(DETERMINISTIC_ASSET_SNAPSHOT_GENERATOR_VERSION);
    // Generated prose is never the source of truth — it cites the rows it came from.
    expect(result.snapshot?.supportingReferences).toMatchObject({
      assetIds: [asset.id],
      assetMemoryIds: [memory.id],
    });
  });

  it("reuses an unchanged snapshot rather than regenerating it", async () => {
    const { snapshots, seedAsset, addMemory } = setup();
    const asset = await seedAsset();
    await addMemory(asset.id);

    const first = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });
    const second = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });

    expect(first.status).toBe("rebuilt");
    expect(second.status).toBe("fresh");
    expect(second.snapshot?.id).toBe(first.snapshot?.id);
  });

  it("rebuilds when the asset is corrected — a cache never outlives the record it cached", async () => {
    const { snapshots, lifecycle, seedAsset, addMemory } = setup();
    const asset = await seedAsset();
    await addMemory(asset.id);
    await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });

    await lifecycle.editAsset({
      actorUserId: OWNER,
      assetId: asset.id,
      edit: { name: "Kitchen refrigerator" },
    });
    const rebuilt = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });

    expect(rebuilt.status).toBe("rebuilt");
    expect(rebuilt.snapshot?.summary).toContain("Kitchen refrigerator");
  });

  it("rebuilds when the asset is archived, so the card never claims it is still in service", async () => {
    const { snapshots, lifecycle, seedAsset, addMemory } = setup();
    const asset = await seedAsset();
    await addMemory(asset.id);
    await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });

    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id });
    const rebuilt = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });

    expect(rebuilt.status).toBe("rebuilt");
    expect(rebuilt.snapshot?.summary).toContain("archived");
  });

  it("rebuilds when a new memory is added", async () => {
    const { snapshots, seedAsset, addMemory } = setup();
    const asset = await seedAsset();
    await addMemory(asset.id);
    await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });

    await addMemory(asset.id, {
      label: "Warranty expires",
      value: { type: "date", date: "2027-01-04" },
    });
    const rebuilt = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });

    expect(rebuilt.status).toBe("rebuilt");
    expect(rebuilt.snapshot?.summary).toContain("2027-01-04");
  });
});

describe("Asset Snapshot — never a source of truth", () => {
  it("always returns the live records alongside the snapshot", async () => {
    const { snapshots, seedAsset, addMemory } = setup();
    const asset = await seedAsset();
    const memory = await addMemory(asset.id);

    const result = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });

    expect(result.context.asset?.id).toBe(asset.id);
    expect(result.context.memories.map((entry) => entry.id)).toEqual([memory.id]);
  });

  it("degrades to the live records when generation fails, and records why", async () => {
    const failing: AssetSnapshotGenerator = () => {
      throw new Error("model unavailable");
    };
    const { snapshots, seedAsset, addMemory } = setup({ generator: failing });
    const asset = await seedAsset();
    await addMemory(asset.id);

    const result = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });

    // The card is gone; the truth is not.
    expect(result.status).toBe("fallback");
    expect(result.context.memories[0]?.value).toEqual({ type: "text", text: "RPWFE" });
  });

  it("retries a previously failed snapshot on the next read instead of serving it as fresh", async () => {
    const asset = await (async () => {
      const seam = setup();
      return { seam, asset: await seam.seedAsset() };
    })();
    // A generator that fails once, then succeeds.
    let calls = 0;
    const flaky: AssetSnapshotGenerator = (pack) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("transient");
      }
      return { summary: `ok:${pack.asset.name}`, generatorVersion: "test-v1" };
    };

    const { snapshots, seedAsset, addMemory } = setup({ generator: flaky });
    const seeded = await seedAsset();
    await addMemory(seeded.id);
    void asset;

    const failed = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: seeded.id });
    const retried = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: seeded.id });

    expect(failed.status).toBe("fallback");
    expect(retried.status).toBe("rebuilt");
    expect(retried.snapshot?.summary).toBe("ok:Refrigerator");
  });

  it("never states a suggested memory as fact — a proposal is not truth", async () => {
    const { store, snapshots, seedAsset } = setup();
    const asset = await seedAsset();
    await store.createAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      status: "suggested",
      label: "Serial",
      value: { type: "text", text: "GUESSED" },
      scope: "private",
    });

    const result = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });

    // It reaches neither the prose nor the citations: an un-reviewed guess is not a
    // fact about the asset, and a cache must never quietly promote one.
    expect(result.snapshot?.summary).not.toContain("GUESSED");
    expect(result.snapshot?.supportingReferences.assetMemoryIds).toEqual([]);
  });
});

describe("Asset Snapshot — visibility", () => {
  it("is empty for an asset the caller cannot see", async () => {
    const { snapshots, seedAsset } = setup();
    const asset = await seedAsset();

    const result = await snapshots.getAssetSnapshot({
      callerUserId: "stranger",
      assetId: asset.id,
    });

    expect(result.status).toBe("fallback");
    expect(result.snapshot).toBeNull();
    expect(result.context.asset).toBeNull();
  });

  it("builds each member their own snapshot — a private detail never leaks into another member's card", async () => {
    const { store, snapshots, lifecycle, review } = setup();
    const household = await seedOwnerMemberHousehold(store, OWNER, MEMBER);
    const householdId = household.id;
    const asset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator",
      kind: "appliance",
      scope: "household",
      householdId,
    });
    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Filter size",
      value: { type: "text", text: "RPWFE" },
      scope: "household",
    });
    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Hidden note",
      value: { type: "text", text: "SECRET" },
      scope: "private",
    });

    const ownerView = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });
    const memberView = await snapshots.getAssetSnapshot({
      callerUserId: MEMBER,
      assetId: asset.id,
    });

    expect(ownerView.snapshot?.summary).toContain("SECRET");
    // The member's snapshot is built from the member's own visibility-filtered pack —
    // the cache is per caller, so it can never widen access (#196 user stories 7, 8).
    expect(memberView.snapshot?.summary).not.toContain("SECRET");
    expect(memberView.snapshot?.summary).toContain("RPWFE");
    expect(memberView.snapshot?.supportingReferences.assetMemoryIds).toHaveLength(1);
  });
});
