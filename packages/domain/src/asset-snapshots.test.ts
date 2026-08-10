import { describe, expect, it } from "vitest";
import type { AssetMemory } from "./asset-memories";
import {
  type AssetSnapshotInputPack,
  buildAssetSnapshotPrompt,
  collectAssetSnapshotReferences,
  computeAssetSnapshotFingerprint,
  DETERMINISTIC_ASSET_SNAPSHOT_GENERATOR_VERSION,
  describeAssetMemoryValue,
  generateDeterministicAssetSnapshot,
} from "./asset-snapshots";
import type { Asset } from "./assets";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "asset-1",
    ownerUserId: "owner-1",
    name: "Refrigerator",
    kind: "appliance",
    status: "active",
    scope: "household",
    ownership: "member_owned",
    householdId: "household-1",
    archivedAt: null,
    revision: 0,
    createdByUserId: "owner-1",
    lastActorUserId: "owner-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function memory(overrides: Partial<AssetMemory> = {}): AssetMemory {
  return {
    id: "memory-1",
    assetId: "asset-1",
    ownerUserId: "owner-1",
    status: "active",
    label: "Filter size",
    value: { type: "text", text: "RPWFE" },
    notes: null,
    scope: "household",
    ownership: "member_owned",
    householdId: "household-1",
    revision: 0,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: "owner-1",
    lastActorUserId: "owner-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function pack(overrides: Partial<AssetSnapshotInputPack> = {}): AssetSnapshotInputPack {
  return {
    asset: asset(),
    memories: [memory()],
    evidence: [],
    relatedAssets: [],
    personLinks: [],
    actions: [],
    ...overrides,
  };
}

describe("describeAssetMemoryValue", () => {
  it("renders each typed value exactly, so an exact fact stays exact", () => {
    expect(describeAssetMemoryValue({ type: "text", text: "RPWFE" })).toBe("RPWFE");
    expect(describeAssetMemoryValue({ type: "date", date: "2026-03-14" })).toBe("2026-03-14");
    expect(describeAssetMemoryValue({ type: "amount", amount: 49.5, currency: "USD" })).toBe(
      "49.50 USD",
    );
    expect(describeAssetMemoryValue(null)).toBe("");
  });
});

describe("collectAssetSnapshotReferences", () => {
  it("cites every supporting record the snapshot was built from", () => {
    const references = collectAssetSnapshotReferences(
      pack({
        memories: [memory({ id: "memory-a" }), memory({ id: "memory-b" })],
        evidence: [
          { id: "evidence-a", kind: "receipt", label: "Receipt", updatedAt: NOW },
          { id: "evidence-b", kind: "manual", label: "Manual", updatedAt: NOW },
        ],
        relatedAssets: [
          { linkId: "link-a", relation: "fits", assetId: "asset-2", assetName: "Water filter" },
        ],
        personLinks: [
          { linkId: "plink-a", relation: "services", personId: "person-1", personName: "Sam" },
        ],
        actions: [
          { id: "action-a", title: "Replace filter", status: "open", dueAt: null, updatedAt: NOW },
        ],
      }),
    );

    expect(references).toEqual({
      assetIds: ["asset-1"],
      assetMemoryIds: ["memory-a", "memory-b"],
      assetEvidenceIds: ["evidence-a", "evidence-b"],
      relatedAssetLinkIds: ["link-a"],
      assetPersonLinkIds: ["plink-a"],
      generalActionIds: ["action-a"],
    });
  });
});

describe("computeAssetSnapshotFingerprint", () => {
  it("is stable for unchanged inputs — an unchanged asset never rebuilds", () => {
    expect(computeAssetSnapshotFingerprint(pack())).toBe(computeAssetSnapshotFingerprint(pack()));
  });

  it("flips when a memory's exact value is corrected, even if updatedAt did not move", () => {
    const before = computeAssetSnapshotFingerprint(pack());
    const after = computeAssetSnapshotFingerprint(
      pack({ memories: [memory({ value: { type: "text", text: "MWF" } })] }),
    );

    expect(after).not.toBe(before);
  });

  it("flips when a memory is added, removed, or re-labeled", () => {
    const base = computeAssetSnapshotFingerprint(pack());

    expect(computeAssetSnapshotFingerprint(pack({ memories: [] }))).not.toBe(base);
    expect(
      computeAssetSnapshotFingerprint(pack({ memories: [memory({ label: "Filter model" })] })),
    ).not.toBe(base);
  });

  it("flips when the asset is archived or renamed", () => {
    const base = computeAssetSnapshotFingerprint(pack());

    expect(
      computeAssetSnapshotFingerprint(pack({ asset: asset({ status: "archived" }) })),
    ).not.toBe(base);
    expect(computeAssetSnapshotFingerprint(pack({ asset: asset({ name: "Fridge" }) }))).not.toBe(
      base,
    );
  });

  it("flips when a linked action changes status, so a completed replacement refreshes the card", () => {
    const before = computeAssetSnapshotFingerprint(
      pack({
        actions: [
          { id: "a1", title: "Replace filter", status: "open", dueAt: null, updatedAt: NOW },
        ],
      }),
    );
    const after = computeAssetSnapshotFingerprint(
      pack({
        actions: [
          { id: "a1", title: "Replace filter", status: "completed", dueAt: null, updatedAt: NOW },
        ],
      }),
    );

    expect(after).not.toBe(before);
  });

  it("does not depend on the order records arrive in", () => {
    const ordered = computeAssetSnapshotFingerprint(
      pack({ memories: [memory({ id: "a" }), memory({ id: "b" })] }),
    );
    const reversed = computeAssetSnapshotFingerprint(
      pack({ memories: [memory({ id: "b" }), memory({ id: "a" })] }),
    );

    expect(reversed).toBe(ordered);
  });
});

describe("generateDeterministicAssetSnapshot", () => {
  it("states reviewed memories as confirmed facts with their exact values", () => {
    const { summary, generatorVersion } = generateDeterministicAssetSnapshot(
      pack({
        memories: [
          memory({ id: "m1", label: "Filter size", value: { type: "text", text: "RPWFE" } }),
          memory({
            id: "m2",
            label: "Warranty expires",
            value: { type: "date", date: "2027-01-04" },
          }),
        ],
      }),
    );

    expect(summary).toContain("Filter size: RPWFE");
    expect(summary).toContain("Warranty expires: 2027-01-04");
    expect(generatorVersion).toBe(DETERMINISTIC_ASSET_SNAPSHOT_GENERATOR_VERSION);
  });

  it("never states a suggested memory as fact — a proposal is not truth", () => {
    const { summary } = generateDeterministicAssetSnapshot(
      pack({
        memories: [
          memory({ id: "m1", label: "Filter size", value: { type: "text", text: "RPWFE" } }),
          // A suggested memory must never reach the pack, but if a caller slips one
          // through, the generator still refuses to state it.
          memory({
            id: "m2",
            status: "suggested",
            label: "Serial",
            value: { type: "text", text: "GUESSED" },
          }),
        ],
      }),
    );

    expect(summary).toContain("RPWFE");
    expect(summary).not.toContain("GUESSED");
  });

  it("summarizes evidence as grounding on file, not as a claim about the asset", () => {
    const { summary } = generateDeterministicAssetSnapshot(
      pack({
        evidence: [{ id: "e1", kind: "receipt", label: "Home Depot receipt", updatedAt: NOW }],
      }),
    );

    expect(summary).toContain("Evidence on file");
    expect(summary).toContain("Home Depot receipt");
  });

  it("names related assets and open work without inventing either", () => {
    const { summary } = generateDeterministicAssetSnapshot(
      pack({
        relatedAssets: [
          { linkId: "l1", relation: "fits", assetId: "asset-2", assetName: "Water filter" },
        ],
        actions: [
          {
            id: "a1",
            title: "Replace water filter",
            status: "open",
            dueAt: "2026-09-01",
            updatedAt: NOW,
          },
        ],
      }),
    );

    expect(summary).toContain("Water filter");
    expect(summary).toContain("Replace water filter");
  });

  it("describes a bare anchor without padding it into a story", () => {
    const { summary } = generateDeterministicAssetSnapshot(pack({ memories: [] }));

    expect(summary).toBe("Refrigerator is an appliance you track.");
  });
});

describe("buildAssetSnapshotPrompt", () => {
  it("hands the model only reviewed facts and forbids inventing the rest", () => {
    const prompt = buildAssetSnapshotPrompt(
      pack({
        memories: [
          memory({ id: "m1", label: "Filter size", value: { type: "text", text: "RPWFE" } }),
          memory({
            id: "m2",
            status: "suggested",
            label: "Serial",
            value: { type: "text", text: "GUESSED" },
          }),
        ],
      }),
    );

    expect(prompt).toContain("Filter size: RPWFE");
    // Suggested content is withheld from the prompt entirely — a hard guarantee, not
    // a rule the model is trusted to follow.
    expect(prompt).not.toContain("GUESSED");
    expect(prompt).toContain("Use only the facts provided below");
  });
});
