import { describe, expect, it } from "vitest";
import {
  ASSET_LINK_RELATION_OPTIONS,
  ASSET_PERSON_RELATION_OPTIONS,
  assetLinkRelationLabel,
  assetLinkSchema,
  assetPersonLinkSchema,
  assetPersonRelationLabel,
  requireLinkableAssetPair,
  resolveAssetLinkPerspective,
} from "./asset-links";
import { AssetValidationError } from "./assets";

describe("related asset link relations", () => {
  it("offers exactly the fixed relation set from the spec, with human labels", () => {
    // The fixed label set named by #202: fits, uses, part of, replaces, covers,
    // stored with. No custom relations, no user-managed taxonomy.
    expect(ASSET_LINK_RELATION_OPTIONS.map((option) => option.relation)).toEqual([
      "fits",
      "uses",
      "part_of",
      "replaces",
      "covers",
      "stored_with",
    ]);
    expect(ASSET_LINK_RELATION_OPTIONS.map((option) => option.label)).toEqual([
      "fits",
      "uses",
      "part of",
      "replaces",
      "covers",
      "stored with",
    ]);
  });

  it("labels a relation, falling back to the raw value for safety", () => {
    expect(assetLinkRelationLabel("stored_with")).toBe("stored with");
    expect(assetLinkRelationLabel("part_of")).toBe("part of");
  });
});

describe("related asset link record", () => {
  const base = {
    id: "link-1",
    ownerUserId: "user-1",
    fromAssetId: "asset-a",
    toAssetId: "asset-b",
    relation: "fits",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
  };

  it("is born suggested unless a status is given — inference never defaults to truth", () => {
    expect(assetLinkSchema.parse(base).status).toBe("suggested");
    expect(assetLinkSchema.parse({ ...base, status: "active" }).status).toBe("active");
  });

  it("carries optional grounding, null by default", () => {
    expect(assetLinkSchema.parse(base).sourceRecordId).toBeNull();
  });
});

describe("requireLinkableAssetPair", () => {
  it("rejects linking an asset to itself with a curated message", () => {
    expect(() => requireLinkableAssetPair("asset-a", "asset-a")).toThrow(AssetValidationError);
  });

  it("accepts two distinct assets", () => {
    expect(() => requireLinkableAssetPair("asset-a", "asset-b")).not.toThrow();
  });
});

describe("resolveAssetLinkPerspective", () => {
  const link = { fromAssetId: "asset-a", toAssetId: "asset-b" };

  it("reads outgoing from the link's subject side", () => {
    expect(resolveAssetLinkPerspective(link, "asset-a")).toEqual({
      otherAssetId: "asset-b",
      direction: "outgoing",
    });
  });

  it("reads incoming from the link's object side", () => {
    expect(resolveAssetLinkPerspective(link, "asset-b")).toEqual({
      otherAssetId: "asset-a",
      direction: "incoming",
    });
  });

  it("returns null for an asset the link does not touch", () => {
    expect(resolveAssetLinkPerspective(link, "asset-c")).toBeNull();
  });
});

describe("asset person link relations", () => {
  it("offers exactly the fixed contextual relation set, with human labels", () => {
    // The PRD's contextual person relationships: recommended, borrowed, uses,
    // stores, services, knows about — context only, never ownership (#196, #202).
    expect(ASSET_PERSON_RELATION_OPTIONS.map((option) => option.relation)).toEqual([
      "recommended",
      "borrowed",
      "uses",
      "stores",
      "services",
      "knows_about",
    ]);
    expect(ASSET_PERSON_RELATION_OPTIONS.map((option) => option.label)).toEqual([
      "recommended it",
      "borrowed it",
      "uses it",
      "stores it",
      "services it",
      "knows about it",
    ]);
  });

  it("labels a person relation", () => {
    expect(assetPersonRelationLabel("knows_about")).toBe("knows about it");
  });
});

describe("asset person link record", () => {
  it("parses a minimal contextual link — no scope, no ownership fields", () => {
    const link = assetPersonLinkSchema.parse({
      id: "person-link-1",
      ownerUserId: "user-1",
      assetId: "asset-a",
      personId: "person-1",
      relation: "borrowed",
      createdAt: new Date("2026-07-01T00:00:00Z"),
    });
    expect(link.relation).toBe("borrowed");
  });
});
