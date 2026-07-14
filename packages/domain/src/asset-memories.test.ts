import { describe, expect, it } from "vitest";
import {
  AssetValidationError,
  assetMemorySchema,
  assetMemoryValueSchema,
  createAssetMemorySchema,
  defaultChildScopeForAsset,
  isEmptyAssetMemoryEdit,
  requireChildScopeWithinAsset,
  resolveAssetMemoryContentPatch,
  resolveLinkedChildVisibility,
} from "./index";

const BASE = {
  assetId: "asset-1",
  ownerUserId: "user-1",
  label: "Filter size",
  value: { type: "text", text: "EDR3RXD1" },
} as const;

describe("asset memory values", () => {
  it("accepts a typed text value", () => {
    expect(assetMemoryValueSchema.parse({ type: "text", text: "EDR3RXD1" })).toEqual({
      type: "text",
      text: "EDR3RXD1",
    });
  });

  it("accepts a typed calendar date value", () => {
    expect(assetMemoryValueSchema.parse({ type: "date", date: "2026-03-14" })).toEqual({
      type: "date",
      date: "2026-03-14",
    });
    expect(() => assetMemoryValueSchema.parse({ type: "date", date: "March 14" })).toThrow();
  });

  it("accepts a lightweight money value without becoming a finance product", () => {
    expect(
      assetMemoryValueSchema.parse({ type: "amount", amount: 42.99, currency: "usd" }),
    ).toEqual({ type: "amount", amount: 42.99, currency: "USD" });
    expect(() => assetMemoryValueSchema.parse({ type: "amount", amount: -1 })).toThrow();
  });
});

describe("asset memory schema", () => {
  it("creates a suggested, private memory by default", () => {
    const memory = createAssetMemorySchema.parse(BASE);
    expect(memory.status).toBe("suggested");
    expect(memory.scope).toBe("private");
    expect(memory.notes).toBeNull();
    expect(memory.reviewGroupId).toBeNull();
    expect(memory.sourceRecordId).toBeNull();
  });

  it("accepts freeform notes without a typed value", () => {
    const memory = createAssetMemorySchema.parse({
      ...BASE,
      label: "Maintenance note",
      value: null,
      notes: "Rattles when the ice maker runs; watch it.",
    });
    expect(memory.value).toBeNull();
    expect(memory.notes).toContain("Rattles");
  });

  it("rejects a memory with neither a typed value nor notes", () => {
    expect(() => createAssetMemorySchema.parse({ ...BASE, value: null })).toThrow();
  });

  it("restricts memory visibility to private or household in this slice", () => {
    expect(() => createAssetMemorySchema.parse({ ...BASE, scope: "shared" })).toThrow();
  });

  it("round-trips a persisted memory", () => {
    const now = new Date();
    const memory = assetMemorySchema.parse({
      ...BASE,
      id: "memory-1",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    expect(memory.id).toBe("memory-1");
    expect(memory.value).toEqual({ type: "text", text: "EDR3RXD1" });
  });
});

describe("edit-before-accept content patches", () => {
  const current = {
    label: "Filter size",
    value: { type: "text", text: "EDR3RXD1" } as const,
    notes: null,
  };

  it("treats an empty edit as empty", () => {
    expect(isEmptyAssetMemoryEdit({})).toBe(true);
    expect(isEmptyAssetMemoryEdit({ label: "Filter model" })).toBe(false);
  });

  it("patches only the fields the edit names", () => {
    const patch = resolveAssetMemoryContentPatch(current, { label: "Filter model" });
    expect(patch).toEqual({ label: "Filter model" });
  });

  it("replaces the typed value and can add notes", () => {
    const patch = resolveAssetMemoryContentPatch(current, {
      value: { type: "text", text: "EDR4RXD1" },
      notes: "Corrected from the receipt.",
    });
    expect(patch.value).toEqual({ type: "text", text: "EDR4RXD1" });
    expect(patch.notes).toBe("Corrected from the receipt.");
  });

  it("rejects an edit that would leave neither a value nor notes", () => {
    expect(() => resolveAssetMemoryContentPatch(current, { value: null })).toThrow(
      AssetValidationError,
    );
  });

  it("rejects a no-op edit", () => {
    expect(() => resolveAssetMemoryContentPatch(current, {})).toThrow(AssetValidationError);
  });
});

describe("child-scope ceiling (#196)", () => {
  it("allows a memory as narrow as or narrower than its asset", () => {
    expect(() =>
      requireChildScopeWithinAsset({ childScope: "private", assetScope: "household" }),
    ).not.toThrow();
    expect(() =>
      requireChildScopeWithinAsset({ childScope: "household", assetScope: "household" }),
    ).not.toThrow();
    expect(() =>
      requireChildScopeWithinAsset({ childScope: "private", assetScope: "private" }),
    ).not.toThrow();
  });

  it("rejects a memory broader than its asset", () => {
    expect(() =>
      requireChildScopeWithinAsset({ childScope: "household", assetScope: "private" }),
    ).toThrow(AssetValidationError);
    expect(() =>
      requireChildScopeWithinAsset({ childScope: "household", assetScope: "shared" }),
    ).toThrow(AssetValidationError);
  });

  it("defaults a memory to its asset's scope where this slice supports it, else private", () => {
    expect(defaultChildScopeForAsset("household")).toBe("household");
    expect(defaultChildScopeForAsset("shared")).toBe("private");
    expect(defaultChildScopeForAsset("private")).toBe("private");
  });

  it("clamps a linked memory's visibility to what the target asset allows", () => {
    const householdTarget = { scope: "household", householdId: "hh-1" } as const;
    expect(
      resolveLinkedChildVisibility({ childScope: "household", target: householdTarget }),
    ).toEqual({ scope: "household", householdId: "hh-1" });
    expect(
      resolveLinkedChildVisibility({
        childScope: "household",
        target: { scope: "private", householdId: null },
      }),
    ).toEqual({ scope: "private", householdId: null });
    expect(
      resolveLinkedChildVisibility({
        childScope: "private",
        target: householdTarget,
      }),
    ).toEqual({ scope: "private", householdId: null });
  });
});
