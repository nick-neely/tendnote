import { describe, expect, it } from "vitest";
import {
  ASSET_EVIDENCE_FILE_TYPES_LABEL,
  ASSET_EVIDENCE_MAX_FILE_BYTES,
  AssetValidationError,
  assertAssetEvidenceFileAccepted,
  assertAssetEvidenceFileSignature,
  assetEvidenceLabelForKind,
  assetEvidenceMoneySchema,
  createAssetEvidenceSchema,
  defaultChildScopeForAsset,
  isAssetEvidenceImage,
  requireChildScopeWithinAsset,
  resolveLinkedChildVisibility,
} from "./index";

const BASE = {
  assetId: "asset-1",
  ownerUserId: "user-1",
  kind: "receipt",
  label: "Home Depot receipt",
  fileName: "receipt.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 48_213,
} as const;

describe("asset evidence schema", () => {
  it("creates private evidence with null metadata by default", () => {
    const evidence = createAssetEvidenceSchema.parse(BASE);
    expect(evidence.scope).toBe("private");
    expect(evidence.url).toBeNull();
    expect(evidence.capturedText).toBeNull();
    expect(evidence.money).toBeNull();
    expect(evidence.purchasedOn).toBeNull();
    expect(evidence.renewsOn).toBeNull();
    expect(evidence.reviewGroupId).toBeNull();
    expect(evidence.sourceRecordId).toBeNull();
  });

  it("requires substance: a file, a link, or retained text", () => {
    expect(() =>
      createAssetEvidenceSchema.parse({
        assetId: "asset-1",
        ownerUserId: "user-1",
        kind: "photo",
        label: "Empty",
      }),
    ).toThrow(/file, a link, or text/i);

    // Retained text alone is enough — the future-OCR foundation (#196).
    const note = createAssetEvidenceSchema.parse({
      assetId: "asset-1",
      ownerUserId: "user-1",
      kind: "note",
      label: "Sticker on the filter housing",
      capturedText: "Replace with EDR3RXD1 every 6 months",
    });
    expect(note.capturedText).toContain("EDR3RXD1");
  });

  it("requires link evidence to carry an http(s) url", () => {
    expect(() =>
      createAssetEvidenceSchema.parse({
        assetId: "asset-1",
        ownerUserId: "user-1",
        kind: "link",
        label: "Manual",
        capturedText: "see manufacturer site",
      }),
    ).toThrow(/link needs a url/i);

    expect(() =>
      createAssetEvidenceSchema.parse({
        assetId: "asset-1",
        ownerUserId: "user-1",
        kind: "link",
        label: "Manual",
        url: "ftp://example.com/manual.pdf",
      }),
    ).toThrow();

    const link = createAssetEvidenceSchema.parse({
      assetId: "asset-1",
      ownerUserId: "user-1",
      kind: "link",
      label: "Owner's manual",
      url: "https://example.com/manual.pdf",
    });
    expect(link.url).toBe("https://example.com/manual.pdf");
  });

  it("keeps file metadata all-or-none so a torn file record cannot parse", () => {
    expect(() =>
      createAssetEvidenceSchema.parse({
        ...BASE,
        mimeType: undefined,
      }),
    ).toThrow(/file metadata/i);
  });

  it("carries lightweight money and date metadata without becoming a finance product", () => {
    const evidence = createAssetEvidenceSchema.parse({
      ...BASE,
      money: { amount: 42.99, currency: "usd" },
      purchasedOn: "2026-03-14",
      renewsOn: "2027-03-14",
    });
    expect(evidence.money).toEqual({ amount: 42.99, currency: "USD" });
    expect(evidence.purchasedOn).toBe("2026-03-14");
    expect(evidence.renewsOn).toBe("2027-03-14");

    expect(() => assetEvidenceMoneySchema.parse({ amount: -1 })).toThrow();
    expect(() => createAssetEvidenceSchema.parse({ ...BASE, purchasedOn: "March 14" })).toThrow();
  });
});

describe("asset evidence file constraints", () => {
  it("accepts an ordinary receipt image", () => {
    expect(() =>
      assertAssetEvidenceFileAccepted({ mimeType: "image/jpeg", sizeBytes: 48_213 }),
    ).not.toThrow();
    expect(() =>
      assertAssetEvidenceFileAccepted({ mimeType: "application/pdf", sizeBytes: 1_000_000 }),
    ).not.toThrow();
  });

  it("rejects oversized files with a user-safe message", () => {
    expect(() =>
      assertAssetEvidenceFileAccepted({
        mimeType: "image/jpeg",
        sizeBytes: ASSET_EVIDENCE_MAX_FILE_BYTES + 1,
      }),
    ).toThrow(AssetValidationError);
  });

  it("rejects file types outside the receipt/photo/manual set", () => {
    expect(() =>
      assertAssetEvidenceFileAccepted({ mimeType: "application/zip", sizeBytes: 100 }),
    ).toThrow(AssetValidationError);
    expect(() =>
      assertAssetEvidenceFileAccepted({ mimeType: "text/html", sizeBytes: 100 }),
    ).toThrow(AssetValidationError);
    expect(() =>
      assertAssetEvidenceFileAccepted({ mimeType: "image/gif", sizeBytes: 100 }),
    ).toThrow(AssetValidationError);
  });

  it("names the allowlist once, so captions and errors can never drift from it", () => {
    expect(ASSET_EVIDENCE_FILE_TYPES_LABEL).toBe("JPEG, PNG, WebP, HEIC, or PDF");
    expect(() =>
      assertAssetEvidenceFileAccepted({ mimeType: "application/zip", sizeBytes: 100 }),
    ).toThrow(ASSET_EVIDENCE_FILE_TYPES_LABEL);
  });

  it("knows which evidence renders as an image", () => {
    expect(isAssetEvidenceImage("image/png")).toBe(true);
    expect(isAssetEvidenceImage("application/pdf")).toBe(false);
    expect(isAssetEvidenceImage(null)).toBe(false);
  });
});

describe("asset evidence file signatures", () => {
  const ascii = (text: string) => new TextEncoder().encode(text);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const PDF = new Uint8Array([...ascii("%PDF-1.7"), 10]);
  const WEBP = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]);
  const HEIC = new Uint8Array([0, 0, 0, 24, ...ascii("ftypheic"), 0, 0, 0, 0]);
  const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);

  it("accepts bytes that match their declared type", () => {
    const accepted: Array<[string, Uint8Array]> = [
      ["image/png", PNG],
      ["image/jpeg", JPEG],
      ["application/pdf", PDF],
      ["image/webp", WEBP],
      ["image/heic", HEIC],
      ["image/heif", HEIC],
    ];
    for (const [mimeType, bytes] of accepted) {
      expect(() => assertAssetEvidenceFileSignature({ mimeType, bytes })).not.toThrow();
    }
  });

  it("rejects mislabeled bytes fail-closed — the declared type is caller input", () => {
    // A zip archive claiming to be an image never persists (#201-reachable path).
    const mislabeled: Array<[string, Uint8Array]> = [
      ["image/png", ZIP],
      ["application/pdf", PNG],
      ["image/jpeg", PNG],
      ["image/heic", ZIP],
      // An unknown type has no signature to satisfy — denied, never waved through.
      ["application/zip", ZIP],
    ];
    for (const [mimeType, bytes] of mislabeled) {
      expect(() => assertAssetEvidenceFileSignature({ mimeType, bytes })).toThrow(
        AssetValidationError,
      );
    }
  });
});

describe("asset evidence kinds", () => {
  it("labels every kind for pickers", () => {
    expect(assetEvidenceLabelForKind("receipt")).toBe("Receipt");
    expect(assetEvidenceLabelForKind("link")).toBe("Link");
  });
});

describe("shared child-scope ceiling", () => {
  it("applies to evidence exactly as it applies to memories", () => {
    expect(() =>
      requireChildScopeWithinAsset({ childScope: "private", assetScope: "household" }),
    ).not.toThrow();
    expect(() =>
      requireChildScopeWithinAsset({ childScope: "household", assetScope: "private" }),
    ).toThrow(AssetValidationError);
    expect(defaultChildScopeForAsset("household")).toBe("household");
    expect(defaultChildScopeForAsset("shared")).toBe("private");
    expect(
      resolveLinkedChildVisibility({
        childScope: "household",
        target: { scope: "private", householdId: null },
      }),
    ).toEqual({ scope: "private", householdId: null });
  });
});
