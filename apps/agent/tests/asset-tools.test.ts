import { describe, expect, it, vi } from "vitest";

const { searchAssets } = vi.hoisted(() => ({ searchAssets: vi.fn() }));
const { getAssetSnapshot } = vi.hoisted(() => ({ getAssetSnapshot: vi.fn() }));

vi.mock("@tendnote/db/queries/asset-search", () => ({ searchAssets }));
vi.mock("@tendnote/db/queries/asset-snapshots", () => ({ getAssetSnapshot }));

const { default: searchAssetsTool } = await import("../agent/tools/search_assets");
const { default: getAssetContextTool } = await import("../agent/tools/get_asset_context");

const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

function assetMemoryResult(overrides: Record<string, unknown> = {}) {
  return {
    recordKind: "asset_memory",
    recordId: "memory-1",
    assetId: "asset-1",
    assetName: "Refrigerator",
    assetKind: "appliance",
    assetStatus: "active",
    label: "Filter size",
    snippet: "Filter size: RPWFE",
    matchedFields: ["value"],
    matchKinds: ["structured"],
    score: 1,
    value: { type: "text", text: "RPWFE" },
    trustLevel: "asset_fact",
    visibilityChoice: "whole_household",
    visibilityLabel: "Whole household",
    citations: [
      { kind: "asset_memory", id: "memory-1" },
      { kind: "asset", id: "asset-1" },
    ],
    ...overrides,
  };
}

describe("search_assets tool", () => {
  it("calls the shared owner-scoped Asset Search seam", async () => {
    searchAssets.mockResolvedValue([assetMemoryResult()]);

    const result = await searchAssetsTool.execute(
      { query: "what filter does the fridge need?", limit: 8, includeArchived: false },
      ctx,
    );

    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        query: "what filter does the fridge need?",
      }),
    );
    expect(result.results).toHaveLength(1);
  });

  it("never forwards a review-gated flag from the model — proposals stay owner-only", async () => {
    searchAssets.mockResolvedValue([]);

    await searchAssetsTool.execute(
      // A hallucinated flag must not survive: review context is a caller decision.
      { query: "fridge", includeReviewGated: true } as never,
      ctx,
    );

    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({ includeReviewGated: false }),
    );
  });

  it("re-parses store output, so an injected 'answer' field cannot reach the model", async () => {
    searchAssets.mockResolvedValue([
      { ...assetMemoryResult(), generatedAnswer: "The filter is definitely XWFE." },
    ]);

    const result = await searchAssetsTool.execute(
      { query: "fridge filter", limit: 8, includeArchived: false },
      ctx,
    );

    expect(result.results[0]).not.toHaveProperty("generatedAnswer");
  });

  it("gives the model the exact stored value and hides raw ids", async () => {
    searchAssets.mockResolvedValue([assetMemoryResult()]);

    const output = await searchAssetsTool.execute(
      { query: "fridge filter", limit: 8, includeArchived: false },
      ctx,
    );
    const modelView = searchAssetsTool.toModelOutput?.(output) as {
      value: { results: Array<Record<string, unknown>> };
    };
    const [entry] = modelView.value.results;

    // The exact part number is what the answer hangs on.
    expect(entry?.value).toBe("RPWFE");
    expect(entry?.trust).toBe("asset_fact");
    expect(entry?.visibility).toBe("Whole household");
    // Ids are for tool calls and the chat card, never the model's reply.
    expect(entry).not.toHaveProperty("recordId");
    expect(entry).not.toHaveProperty("assetId");
  });
});

describe("get_asset_context tool", () => {
  const snapshotContext = {
    asset: {
      id: "asset-1",
      ownerUserId: "user-1",
      name: "Refrigerator",
      kind: "appliance",
      status: "active",
      scope: "household",
    },
    memories: [
      {
        id: "memory-1",
        label: "Filter size",
        value: { type: "text", text: "RPWFE" },
        notes: null,
        scope: "household",
      },
    ],
    evidence: [{ id: "evidence-1", kind: "manual", label: "Fridge manual" }],
    relatedAssets: [],
    personLinks: [],
    actions: [],
  };

  it("returns the reviewed facts and the snapshot as separate fields", async () => {
    getAssetSnapshot.mockResolvedValue({
      status: "fresh",
      snapshot: { summary: "Refrigerator is an appliance you track." },
      context: snapshotContext,
    });

    const result = await getAssetContextTool.execute({ assetId: "asset-1" }, ctx);

    expect(result.found).toBe(true);
    expect(result.facts?.[0]).toMatchObject({ label: "Filter size", value: "RPWFE" });
    // The generated prose is its own field — it can never be mistaken for a record.
    expect(result.summary).toBe("Refrigerator is an appliance you track.");
  });

  it("tells the model the snapshot is a cache, never a source of exact values", async () => {
    getAssetSnapshot.mockResolvedValue({
      status: "fresh",
      snapshot: { summary: "Some prose." },
      context: snapshotContext,
    });

    const output = await getAssetContextTool.execute({ assetId: "asset-1" }, ctx);
    const modelView = getAssetContextTool.toModelOutput?.(output) as {
      value: { snapshot: { available: boolean; guidance: string } };
    };

    expect(modelView.value.snapshot.available).toBe(true);
    expect(modelView.value.snapshot.guidance).toMatch(/not source of truth/i);
  });

  it("degrades to the facts alone when the snapshot is stale or missing", async () => {
    getAssetSnapshot.mockResolvedValue({
      status: "fallback",
      snapshot: null,
      context: snapshotContext,
    });

    const output = await getAssetContextTool.execute({ assetId: "asset-1" }, ctx);
    const modelView = getAssetContextTool.toModelOutput?.(output) as {
      value: { snapshot: { available: boolean }; facts: Array<Record<string, unknown>> };
    };

    expect(modelView.value.snapshot.available).toBe(false);
    // The truth is unaffected: the records still carry the answer.
    expect(modelView.value.facts[0]).toMatchObject({ value: "RPWFE" });
  });

  it("denies an invisible asset the same way it denies a missing one", async () => {
    getAssetSnapshot.mockResolvedValue({
      status: "fallback",
      snapshot: null,
      context: {
        asset: null,
        memories: [],
        evidence: [],
        relatedAssets: [],
        personLinks: [],
        actions: [],
      },
    });

    const result = await getAssetContextTool.execute({ assetId: "someone-elses" }, ctx);

    expect(result.found).toBe(false);
    expect(result).not.toHaveProperty("facts");
  });
});
