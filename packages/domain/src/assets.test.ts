import { describe, expect, it } from "vitest";
import {
  ASSET_KIND_OPTIONS,
  AssetValidationError,
  assertAssetEditable,
  assetKindSchema,
  assetLabelForKind,
  assetSchema,
  assetUpdateSchema,
  createAssetSchema,
  resolveAssetTransition,
} from "./assets";

describe("asset kinds", () => {
  it("accepts only the small fixed kind set", () => {
    for (const option of ASSET_KIND_OPTIONS) {
      expect(assetKindSchema.parse(option.kind)).toBe(option.kind);
    }
    expect(() => assetKindSchema.parse("folder")).toThrow();
    expect(() => assetKindSchema.parse("document")).toThrow();
  });

  it("labels every kind for the surface", () => {
    expect(assetLabelForKind("appliance")).toBe("Appliance");
    expect(assetLabelForKind("subscription")).toBe("Subscription");
  });
});

describe("asset lifecycle transitions", () => {
  it("archives an active asset", () => {
    expect(resolveAssetTransition("active", "archive")).toBe("archived");
  });

  it("restores an archived asset", () => {
    expect(resolveAssetTransition("archived", "restore")).toBe("active");
  });

  it("rejects archiving an already-archived asset", () => {
    expect(() => resolveAssetTransition("archived", "archive")).toThrow(AssetValidationError);
  });

  it("rejects restoring an active asset", () => {
    expect(() => resolveAssetTransition("active", "restore")).toThrow(AssetValidationError);
  });

  it("allows edits only while active", () => {
    expect(() => assertAssetEditable("active")).not.toThrow();
    expect(() => assertAssetEditable("archived")).toThrow(AssetValidationError);
  });
});

describe("asset schemas", () => {
  const base = {
    ownerUserId: "user-1",
    name: "Refrigerator water filter",
    kind: "appliance" as const,
  };

  it("creates a private active asset by default", () => {
    const parsed = createAssetSchema.parse(base);
    expect(parsed.status).toBe("active");
    expect(parsed.scope).toBe("private");
    expect(parsed.householdId).toBeNull();
    expect(parsed.archivedAt).toBeNull();
  });

  it("rejects a blank name", () => {
    expect(() => createAssetSchema.parse({ ...base, name: "  " })).toThrow();
  });

  it("keeps the update schema defaults-free so a partial patch never wipes columns", () => {
    // A patch that only archives must not inject scope/name/kind defaults for
    // absent keys — mirroring the General Action defaults-free update contract.
    const patch = assetUpdateSchema.parse({ status: "archived" });
    expect(patch).toEqual({ status: "archived" });
    expect("scope" in patch).toBe(false);
    expect("name" in patch).toBe(false);
  });

  it("round-trips a persisted asset", () => {
    const now = new Date();
    const asset = assetSchema.parse({
      ...base,
      id: "asset-1",
      status: "archived",
      scope: "household",
      householdId: "hh-1",
      archivedAt: now,
      createdByUserId: "user-1",
      lastActorUserId: "user-1",
      createdAt: now,
      updatedAt: now,
    });
    expect(asset.status).toBe("archived");
    expect(asset.householdId).toBe("hh-1");
  });
});
