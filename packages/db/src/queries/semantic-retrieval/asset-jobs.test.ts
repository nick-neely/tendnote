import { describe, expect, it } from "vitest";
import { createHarness, OWNER } from "./harness";

/**
 * Assets and Asset Memories ride the existing embedding pipeline (#204). What matters
 * here is the *policy* at embed time: what becomes retrievable at all, and what the
 * embedded text says — because the embedded text is what a fuzzy query actually lands on.
 */
describe("asset embedding jobs", () => {
  it("embeds an active asset as an anchor", async () => {
    const harness = createHarness();
    const asset = await harness.createAsset({ name: "Refrigerator" });

    const result = await harness.embedAsset(asset.id);

    expect(result.outcome).toBe("completed");
    expect(result.embedding?.recordKind).toBe("asset");
    expect(result.embedding?.trustLevel).toBe("asset_anchor");
    expect(result.embedding?.embeddedText).toContain("Refrigerator");
  });

  it("embeds an archived asset — a sold or replaced thing stays recallable", async () => {
    const harness = createHarness();
    const asset = await harness.createAsset({ status: "archived", archivedAt: new Date() });

    expect((await harness.embedAsset(asset.id)).outcome).toBe("completed");
  });

  it("never embeds a suggested asset — an un-reviewed guess is not a thing you own", async () => {
    const harness = createHarness();
    const asset = await harness.createAsset({ status: "suggested" });

    const result = await harness.embedAsset(asset.id);

    expect(result.outcome).toBe("skipped");
    expect(result.reason).toBe("asset_not_durable");
    expect(result.embedding).toBeNull();
  });

  it("folds the asset into a memory's embedded text, so 'the kitchen fridge' can reach its filter size", async () => {
    const harness = createHarness();
    const asset = await harness.createAsset({ name: "Kitchen refrigerator" });
    const memory = await harness.createAssetMemory({
      assetId: asset.id,
      label: "Filter size",
      value: { type: "text", text: "RPWFE" },
    });

    const result = await harness.embedAssetMemory(memory.id);

    expect(result.outcome).toBe("completed");
    expect(result.embedding?.trustLevel).toBe("asset_fact");
    // Both the thing and the fact are in the vector's text — the fact alone would be
    // unreachable from a question phrased about the appliance.
    expect(result.embedding?.embeddedText).toContain("Kitchen refrigerator");
    expect(result.embedding?.embeddedText).toContain("Filter size: RPWFE");
  });

  it("embeds a suggested memory so owner-only review can find it, leaving the scope gate to the read seam", async () => {
    const harness = createHarness();
    const asset = await harness.createAsset();
    const memory = await harness.createAssetMemory({ assetId: asset.id, status: "suggested" });

    expect((await harness.embedAssetMemory(memory.id)).outcome).toBe("completed");
  });

  it("never embeds a dismissed memory", async () => {
    const harness = createHarness();
    const asset = await harness.createAsset();
    const memory = await harness.createAssetMemory({ assetId: asset.id, status: "dismissed" });

    const result = await harness.embedAssetMemory(memory.id);

    expect(result.outcome).toBe("skipped");
    expect(result.reason).toBe("asset_memory_not_retrievable_status");
  });

  it("never embeds a memory hanging off a suggested asset — the anchor gates the fact", async () => {
    const harness = createHarness();
    const asset = await harness.createAsset({ status: "suggested" });
    const memory = await harness.createAssetMemory({ assetId: asset.id, status: "active" });

    const result = await harness.embedAssetMemory(memory.id);

    expect(result.outcome).toBe("skipped");
    expect(result.reason).toBe("asset_not_durable");
  });

  it("never re-embeds unchanged text", async () => {
    const harness = createHarness();
    const asset = await harness.createAsset();

    const first = await harness.embedAsset(asset.id);
    const second = await harness.embedAsset(asset.id);

    expect(second.embedding?.id).toBe(first.embedding?.id);
  });

  it("keeps another owner's asset unreachable", async () => {
    const harness = createHarness();
    const asset = await harness.createAsset();

    const result = await harness.embedAsset(asset.id, "user-2");

    expect(result.outcome).toBe("skipped");
    expect(result.reason).toBe("asset_not_found");
  });

  it("audits every asset embedding job", async () => {
    const harness = createHarness();
    const asset = await harness.createAsset({ ownerUserId: OWNER });

    await harness.embedAsset(asset.id);

    expect(await harness.auditActions()).toEqual([
      "embedding_job.enqueue",
      "embedding_job.completed",
    ]);
  });
});
