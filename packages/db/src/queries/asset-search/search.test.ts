import type { Asset, AssetEvidence, AssetMemory, HouseholdMembership } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import type { EmbeddingAdapter } from "../semantic-retrieval/types";
import { type AssetSearchSeed, createInMemoryAssetSearchStore } from "./in-memory-store";
import { createAssetSearch } from "./queries";

const OWNER = "user-1";
const MEMBER = "user-2";
const HOUSEHOLD = "household-1";
const NOW = new Date("2026-06-01T00:00:00.000Z");
const CONFIG = { model: "fake", version: "v1" };

/**
 * A themed adapter so similarity is exactly predictable: appliance/fridge/filter talk
 * lands on one axis, warranty/expiry talk on another, everything else is orthogonal.
 * This is how the semantic tier is tested without a real embedding model.
 */
const themedAdapter: EmbeddingAdapter = {
  async embedText(input) {
    return { vector: themeVector(input.text), model: input.model, version: input.version };
  },
};

function themeVector(text: string): number[] {
  const lower = text.toLowerCase();
  if (/fridge|refrigerator|filter|kitchen|appliance/.test(lower)) {
    return [1, 0, 0, 0];
  }
  if (/warranty|expire|expiring|coverage/.test(lower)) {
    return [0, 1, 0, 0];
  }
  if (/vehicle|car|tire/.test(lower)) {
    return [0, 0, 1, 0];
  }
  return [0, 0, 0, 1];
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-fridge",
    ownerUserId: OWNER,
    name: "Refrigerator",
    kind: "appliance",
    status: "active",
    scope: "private",
    householdId: null,
    archivedAt: null,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function memory(overrides: Partial<AssetMemory> = {}): AssetMemory {
  return {
    id: "memory-filter",
    assetId: "asset-fridge",
    ownerUserId: OWNER,
    status: "active",
    label: "Filter size",
    value: { type: "text", text: "RPWFE" },
    notes: null,
    scope: "private",
    householdId: null,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function evidence(overrides: Partial<AssetEvidence> = {}): AssetEvidence {
  return {
    id: "evidence-receipt",
    assetId: "asset-fridge",
    ownerUserId: OWNER,
    kind: "receipt",
    label: "Home Depot receipt",
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    url: null,
    capturedText: null,
    money: null,
    purchasedOn: null,
    renewsOn: null,
    scope: "private",
    householdId: null,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: OWNER,
    lastActorUserId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function activeMembership(userId: string): HouseholdMembership {
  return {
    id: `membership-${userId}`,
    householdId: HOUSEHOLD,
    userId,
    role: userId === OWNER ? "owner" : "member",
    status: "active",
    invitedByUserId: OWNER,
    invitedAt: NOW,
    acceptedAt: NOW,
    removedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** An embedding row as the shared pipeline would have written it. */
function embeddingFor(
  recordKind: "asset" | "asset_memory",
  recordId: string,
  text: string,
  ownerUserId = OWNER,
) {
  return { ownerUserId, recordKind, recordId, embedding: themeVector(text) };
}

function search(seed: AssetSearchSeed) {
  return createAssetSearch(createInMemoryAssetSearchStore(seed), themedAdapter, CONFIG);
}

describe("Asset Search — exact recall", () => {
  it("finds an asset by name", async () => {
    const results = await search({ assets: [asset()] }).searchAssets({
      ownerUserId: OWNER,
      query: "refrigerator",
    });

    expect(results.map((result) => result.recordId)).toContain("asset-fridge");
    expect(results[0]?.matchKinds).toContain("exact");
  });

  it("finds an asset through an everyday alias — a typed 'fridge' reaches a stored 'Refrigerator'", async () => {
    const results = await search({ assets: [asset()] }).searchAssets({
      ownerUserId: OWNER,
      query: "kitchen fridge",
    });

    expect(results.map((result) => result.recordId)).toContain("asset-fridge");
  });

  it("finds a memory by its label", async () => {
    const results = await search({ assets: [asset()], memories: [memory()] }).searchAssets({
      ownerUserId: OWNER,
      query: "filter size",
    });

    expect(results.map((result) => result.recordId)).toContain("memory-filter");
  });

  it("returns grounded records, never a generated answer", async () => {
    const [result] = await search({ assets: [asset()], memories: [memory()] }).searchAssets({
      ownerUserId: OWNER,
      query: "RPWFE",
    });

    // Every result is a real row, carries its exact stored value, and cites itself.
    expect(result?.recordKind).toBe("asset_memory");
    expect(result?.value).toEqual({ type: "text", text: "RPWFE" });
    expect(result?.citations).toContainEqual({ kind: "asset_memory", id: "memory-filter" });
    expect(result?.citations).toContainEqual({ kind: "asset", id: "asset-fridge" });
  });
});

describe("Asset Search — structured values", () => {
  it("finds a serial/model/filter size by typing it exactly", async () => {
    const results = await search({ assets: [asset()], memories: [memory()] }).searchAssets({
      ownerUserId: OWNER,
      query: "RPWFE",
    });

    expect(results[0]?.recordId).toBe("memory-filter");
    expect(results[0]?.matchKinds).toContain("structured");
  });

  it("finds a receipt amount", async () => {
    const results = await search({
      assets: [asset()],
      memories: [
        memory({
          id: "memory-price",
          label: "Purchase price",
          value: { type: "amount", amount: 1299.99, currency: "USD" },
        }),
      ],
    }).searchAssets({ ownerUserId: OWNER, query: "$1,299.99" });

    expect(results[0]?.recordId).toBe("memory-price");
    expect(results[0]?.matchKinds).toEqual(["structured"]);
  });

  it("finds a date-valued fact such as a warranty expiry", async () => {
    const results = await search({
      assets: [asset()],
      memories: [
        memory({
          id: "memory-warranty",
          label: "Warranty expires",
          value: { type: "date", date: "2027-01-04" },
        }),
      ],
    }).searchAssets({ ownerUserId: OWNER, query: "2027-01-04" });

    expect(results[0]?.recordId).toBe("memory-warranty");
  });

  it("finds evidence by its receipt amount and purchase date", async () => {
    const seed = {
      assets: [asset()],
      evidence: [evidence({ money: { amount: 42.5, currency: "USD" }, purchasedOn: "2026-02-01" })],
    };

    const byAmount = await search(seed).searchAssets({ ownerUserId: OWNER, query: "$42.50" });
    const byDate = await search(seed).searchAssets({ ownerUserId: OWNER, query: "2026-02-01" });

    expect(byAmount[0]?.recordId).toBe("evidence-receipt");
    expect(byDate[0]?.recordId).toBe("evidence-receipt");
  });

  it("does not treat a bare number as money — a model number is not a price", async () => {
    const results = await search({
      assets: [asset()],
      memories: [
        memory({
          id: "memory-price",
          label: "Purchase price",
          value: { type: "amount", amount: 4396508, currency: "USD" },
        }),
        memory({ id: "memory-model", label: "Model", value: { type: "text", text: "4396508" } }),
      ],
    }).searchAssets({ ownerUserId: OWNER, query: "4396508" });

    // The identifier matches the model text; the amount is not claimed as a price match.
    expect(results[0]?.recordId).toBe("memory-model");
  });
});

describe("Asset Search — fuzzy intent", () => {
  it("finds things related to the kitchen fridge without an exact word match", async () => {
    const results = await search({
      assets: [asset({ name: "Refrigerator" })],
      memories: [memory()],
      embeddings: [
        embeddingFor(
          "asset_memory",
          "memory-filter",
          "Asset: Refrigerator (Appliance) Filter size: RPWFE",
        ),
      ],
    }).searchAssets({ ownerUserId: OWNER, query: "anything for the kitchen fridge" });

    const filter = results.find((result) => result.recordId === "memory-filter");
    expect(filter).toBeDefined();
    expect(filter?.matchKinds).toContain("semantic");
  });

  it("finds warranties expiring soon by meaning, not by wording", async () => {
    const results = await search({
      assets: [asset()],
      memories: [
        memory({
          id: "memory-warranty",
          label: "Coverage ends",
          value: { type: "date", date: "2027-01-04" },
        }),
      ],
      embeddings: [embeddingFor("asset_memory", "memory-warranty", "warranty coverage expires")],
    }).searchAssets({ ownerUserId: OWNER, query: "warranties expiring soon" });

    expect(results.map((result) => result.recordId)).toContain("memory-warranty");
  });

  it("refuses to call a faintly-similar record 'Related' — the semantic tier has a floor", async () => {
    // Cosine similarity is never zero over a warm index: every record is a *little* bit
    // like every query. Without a floor, "boiler" returns the user's entire asset list
    // stamped "Related", which is not a search result — it is noise wearing a claim.
    const results = await search({
      assets: [asset()],
      memories: [
        memory(),
        memory({ id: "memory-ambient", label: "Ambient", value: null, notes: "unrelated" }),
      ],
      embeddings: [
        // cos([1,2,2,2], [1,0,0,0]) ≈ 0.28 — real, and far below anything worth saying.
        {
          ownerUserId: OWNER,
          recordKind: "asset_memory",
          recordId: "memory-ambient",
          embedding: [1, 2, 2, 2],
        },
      ],
    }).searchAssets({ ownerUserId: OWNER, query: "anything for the kitchen fridge" });

    expect(results.map((result) => result.recordId)).not.toContain("memory-ambient");
  });

  it("still surfaces a genuinely close record by meaning alone", async () => {
    const results = await search({
      assets: [asset()],
      memories: [
        memory({ id: "memory-close", label: "Cooling notes", value: null, notes: "cold" }),
      ],
      embeddings: [
        // cos([1,1,1,1], [1,0,0,0]) = 0.5 — over the floor, and a claim worth making.
        {
          ownerUserId: OWNER,
          recordKind: "asset_memory",
          recordId: "memory-close",
          embedding: [1, 1, 1, 1],
        },
      ],
    }).searchAssets({ ownerUserId: OWNER, query: "anything for the kitchen fridge" });

    expect(results.map((result) => result.recordId)).toContain("memory-close");
  });

  it("ranks an exact structured hit above a merely semantic one", async () => {
    const results = await search({
      assets: [asset()],
      memories: [
        memory(),
        memory({ id: "memory-vague", label: "Fridge notes", value: null, notes: "runs cold" }),
      ],
      embeddings: [embeddingFor("asset_memory", "memory-vague", "fridge appliance")],
    }).searchAssets({ ownerUserId: OWNER, query: "RPWFE" });

    expect(results[0]?.recordId).toBe("memory-filter");
  });

  it("still answers exactly when the semantic tier is unavailable", async () => {
    const brokenAdapter: EmbeddingAdapter = {
      async embedText() {
        throw new Error("embedding gateway unavailable");
      },
    };
    const seam = createAssetSearch(
      createInMemoryAssetSearchStore({ assets: [asset()], memories: [memory()] }),
      brokenAdapter,
      CONFIG,
    );

    const results = await seam.searchAssets({ ownerUserId: OWNER, query: "RPWFE" });
    const outcome = await seam.searchAssetsWithStatus({ ownerUserId: OWNER, query: "RPWFE" });

    // Exact and structured recall are the guarantee; the fuzzy tier is an enhancement.
    expect(results[0]?.recordId).toBe("memory-filter");
    expect(outcome.results[0]?.recordId).toBe("memory-filter");
    expect(outcome.semanticAvailable).toBe(false);
  });
});

describe("Asset Search — the semantic tier is scoped by visibility, not by who owns the vector", () => {
  it("finds a co-member's household asset semantically — an embedding written by another member is still retrievable", async () => {
    const results = await search({
      assets: [asset({ ownerUserId: OWNER, scope: "household", householdId: HOUSEHOLD })],
      memories: [memory({ ownerUserId: OWNER, scope: "household", householdId: HOUSEHOLD })],
      // The vectors belong to the member who wrote the records, not to the caller.
      embeddings: [
        embeddingFor("asset", "asset-fridge", "Asset: Refrigerator (Appliance)", OWNER),
        embeddingFor("asset_memory", "memory-filter", "Refrigerator filter size RPWFE", OWNER),
      ],
      householdMemberships: [activeMembership(OWNER), activeMembership(MEMBER)],
    }).searchAssets({ ownerUserId: MEMBER, query: "anything for the kitchen fridge" });

    // The other member can see the household asset, so they must be able to reach it by
    // meaning too — otherwise semantic recall would silently be owner-only.
    expect(results.map((result) => result.recordId)).toContain("memory-filter");
  });

  it("still refuses a co-member's private records semantically", async () => {
    const results = await search({
      assets: [asset({ ownerUserId: OWNER, scope: "household", householdId: HOUSEHOLD })],
      memories: [
        // A private memory under a household asset: visible to its owner alone.
        memory({ ownerUserId: OWNER, scope: "private", householdId: null }),
      ],
      embeddings: [
        embeddingFor("asset_memory", "memory-filter", "Refrigerator filter size RPWFE", OWNER),
      ],
      householdMemberships: [activeMembership(OWNER), activeMembership(MEMBER)],
    }).searchAssets({ ownerUserId: MEMBER, query: "anything for the kitchen fridge" });

    // Vector ownership is not the gate — but per-record visibility still is.
    expect(results.map((result) => result.recordId)).not.toContain("memory-filter");
  });

  it("never reaches another household's records, however similar the vector", async () => {
    const results = await search({
      assets: [asset({ ownerUserId: OWNER, scope: "household", householdId: HOUSEHOLD })],
      memories: [memory({ ownerUserId: OWNER, scope: "household", householdId: HOUSEHOLD })],
      embeddings: [
        embeddingFor("asset_memory", "memory-filter", "Refrigerator filter size RPWFE", OWNER),
      ],
      // The caller is in no household at all.
      householdMemberships: [activeMembership(OWNER)],
    }).searchAssets({ ownerUserId: "outsider", query: "anything for the kitchen fridge" });

    expect(results).toEqual([]);
  });
});

describe("Asset Search — visibility boundaries", () => {
  it("never returns another owner's asset", async () => {
    const results = await search({ assets: [asset()], memories: [memory()] }).searchAssets({
      ownerUserId: "stranger",
      query: "refrigerator RPWFE",
    });

    expect(results).toEqual([]);
  });

  it("keeps a private memory under a household asset hidden from other members", async () => {
    const results = await search({
      assets: [asset({ scope: "household", householdId: HOUSEHOLD })],
      memories: [
        memory({ id: "memory-shared", scope: "household", householdId: HOUSEHOLD }),
        memory({
          id: "memory-private",
          label: "Filter receipt note",
          scope: "private",
          householdId: null,
        }),
      ],
      householdMemberships: [activeMembership(OWNER), activeMembership(MEMBER)],
    }).searchAssets({ ownerUserId: MEMBER, query: "filter" });

    const ids = results.map((result) => result.recordId);
    // The household asset and its household memory are visible; the owner's private
    // child record under that same asset is not (#196 user stories 7, 8).
    expect(ids).toContain("memory-shared");
    expect(ids).not.toContain("memory-private");
  });

  it("never returns private evidence under a household asset to another member", async () => {
    const results = await search({
      assets: [asset({ scope: "household", householdId: HOUSEHOLD })],
      evidence: [evidence({ scope: "private", householdId: null })],
      householdMemberships: [activeMembership(OWNER), activeMembership(MEMBER)],
    }).searchAssets({ ownerUserId: MEMBER, query: "receipt" });

    expect(results.map((result) => result.recordId)).not.toContain("evidence-receipt");
  });

  it("hides the whole asset — and everything under it — when the asset itself is not visible", async () => {
    const results = await search({
      assets: [asset({ scope: "private" })],
      memories: [memory({ scope: "household", householdId: HOUSEHOLD })],
      householdMemberships: [activeMembership(OWNER), activeMembership(MEMBER)],
    }).searchAssets({ ownerUserId: MEMBER, query: "filter refrigerator" });

    expect(results).toEqual([]);
  });
});

describe("Asset Search — review gate", () => {
  it("never surfaces a suggested memory in an ordinary search", async () => {
    const results = await search({
      assets: [asset()],
      memories: [memory({ id: "memory-suggested", status: "suggested" })],
    }).searchAssets({ ownerUserId: OWNER, query: "filter RPWFE" });

    expect(results.map((result) => result.recordId)).not.toContain("memory-suggested");
  });

  it("surfaces the owner's own suggested memory in explicit review context, labeled as a proposal", async () => {
    const results = await search({
      assets: [asset()],
      memories: [memory({ id: "memory-suggested", status: "suggested" })],
    }).searchAssets({ ownerUserId: OWNER, query: "filter RPWFE", includeReviewGated: true });

    const proposal = results.find((result) => result.recordId === "memory-suggested");
    expect(proposal?.trustLevel).toBe("suggested_asset_fact");
  });

  it("never surfaces another member's suggested memory, even in review context", async () => {
    const results = await search({
      assets: [asset({ scope: "household", householdId: HOUSEHOLD })],
      memories: [
        memory({
          id: "memory-suggested",
          status: "suggested",
          scope: "household",
          householdId: HOUSEHOLD,
        }),
      ],
      householdMemberships: [activeMembership(OWNER), activeMembership(MEMBER)],
    }).searchAssets({ ownerUserId: MEMBER, query: "filter RPWFE", includeReviewGated: true });

    expect(results).toEqual([]);
  });

  it("never surfaces a dismissed memory", async () => {
    const results = await search({
      assets: [asset()],
      memories: [memory({ id: "memory-dismissed", status: "dismissed" })],
    }).searchAssets({ ownerUserId: OWNER, query: "filter RPWFE", includeReviewGated: true });

    expect(results).toEqual([]);
  });
});

describe("Asset Search — filters", () => {
  it("leaves archived assets out until asked for", async () => {
    const seed = {
      assets: [asset({ status: "archived", archivedAt: NOW })],
      memories: [memory()],
    };

    const active = await search(seed).searchAssets({ ownerUserId: OWNER, query: "RPWFE" });
    const archived = await search(seed).searchAssets({
      ownerUserId: OWNER,
      query: "RPWFE",
      includeArchived: true,
    });

    expect(active).toEqual([]);
    expect(archived.map((result) => result.recordId)).toContain("memory-filter");
  });

  it("narrows to one asset when asked", async () => {
    const results = await search({
      assets: [asset(), asset({ id: "asset-car", name: "Car filter", kind: "vehicle" })],
      memories: [memory()],
    }).searchAssets({ ownerUserId: OWNER, query: "filter", assetId: "asset-car" });

    expect(results.every((result) => result.assetId === "asset-car")).toBe(true);
  });

  it("narrows by asset kind and by record kind", async () => {
    const seed = {
      assets: [asset(), asset({ id: "asset-car", name: "Car", kind: "vehicle" })],
      memories: [memory()],
    };

    const byAssetKind = await search(seed).searchAssets({
      ownerUserId: OWNER,
      query: "refrigerator car",
      assetKinds: ["vehicle"],
    });
    const byRecordKind = await search(seed).searchAssets({
      ownerUserId: OWNER,
      query: "refrigerator RPWFE",
      recordKinds: ["asset"],
    });

    expect(byAssetKind.every((result) => result.assetKind === "vehicle")).toBe(true);
    expect(byRecordKind.every((result) => result.recordKind === "asset")).toBe(true);
  });

  it("honors the caller's limit", async () => {
    const results = await search({
      assets: [asset()],
      memories: [
        memory({ id: "m1", label: "Filter size" }),
        memory({ id: "m2", label: "Filter model" }),
        memory({ id: "m3", label: "Filter brand" }),
      ],
    }).searchAssets({ ownerUserId: OWNER, query: "filter", limit: 2 });

    expect(results).toHaveLength(2);
  });
});

describe("Asset Search — the proof scenario", () => {
  it("answers 'what filter does the fridge need?' with the exact part, cited", async () => {
    const results = await search({
      assets: [asset({ name: "Refrigerator", scope: "household", householdId: HOUSEHOLD })],
      memories: [
        memory({ scope: "household", householdId: HOUSEHOLD, sourceRecordId: "source-1" }),
      ],
      evidence: [
        evidence({
          scope: "household",
          householdId: HOUSEHOLD,
          label: "Fridge manual",
          kind: "manual",
        }),
      ],
      embeddings: [
        embeddingFor(
          "asset_memory",
          "memory-filter",
          "Asset: Refrigerator (Appliance) Filter size: RPWFE",
        ),
      ],
      householdMemberships: [activeMembership(OWNER)],
    }).searchAssets({ ownerUserId: OWNER, query: "what filter does the fridge need?" });

    const answer = results[0];
    expect(answer?.recordKind).toBe("asset_memory");
    expect(answer?.label).toBe("Filter size");
    expect(answer?.value).toEqual({ type: "text", text: "RPWFE" });
    expect(answer?.trustLevel).toBe("asset_fact");
    expect(answer?.visibilityLabel).toBe("Whole household");
    // The answer stands on records: the memory, its asset, and the note it came from.
    expect(answer?.citations).toEqual([
      { kind: "asset_memory", id: "memory-filter" },
      { kind: "asset", id: "asset-fridge" },
      { kind: "source_record", id: "source-1" },
    ]);
  });
});
