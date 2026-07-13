import type { AssetEvidence } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { toAssetEvidenceView } from "./asset-evidence-view";

const NOW = new Date("2026-07-13T12:00:00Z");

function evidence(overrides: Partial<AssetEvidence> = {}): AssetEvidence {
  return {
    id: "ev-1",
    assetId: "asset-1",
    ownerUserId: "user-1",
    kind: "receipt",
    label: "Home Depot receipt",
    fileName: "receipt.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 48_213,
    url: null,
    capturedText: null,
    money: null,
    purchasedOn: null,
    renewsOn: null,
    scope: "private",
    householdId: null,
    sourceRecordId: null,
    reviewGroupId: null,
    createdByUserId: "user-1",
    lastActorUserId: "user-1",
    createdAt: new Date("2026-07-01T12:00:00-05:00"),
    updatedAt: new Date("2026-07-01T12:00:00-05:00"),
    ...overrides,
  };
}

describe("toAssetEvidenceView (#200)", () => {
  it("maps an uploaded image receipt with a gated file href and a readable size", () => {
    const view = toAssetEvidenceView(evidence(), { callerUserId: "user-1", now: NOW });

    expect(view.kindLabel).toBe("Receipt");
    expect(view.hasFile).toBe(true);
    expect(view.isImage).toBe(true);
    expect(view.fileHref).toBe("/api/asset-evidence/ev-1/file");
    expect(view.sizeLabel).toBe("47 KB");
    expect(view.owned).toBe(true);
    expect(view.addedLabel).toBe("Added Jul 1");
  });

  it("formats money and day-precise dates without shifting the day", () => {
    const view = toAssetEvidenceView(
      evidence({
        money: { amount: 42.99, currency: "USD" },
        purchasedOn: "2026-03-14",
        renewsOn: "2027-03-14",
      }),
      { callerUserId: "user-1", now: NOW },
    );

    expect(view.moneyLabel).toBe("$42.99");
    expect(view.purchasedOnLabel).toBe("Mar 14, 2026");
    expect(view.renewsOnLabel).toBe("Mar 14, 2027");
  });

  it("maps link and note evidence without file affordances", () => {
    const link = toAssetEvidenceView(
      evidence({
        kind: "link",
        label: "Owner's manual",
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        url: "https://example.com/manual.pdf",
      }),
      { callerUserId: "user-1", now: NOW },
    );
    expect(link.hasFile).toBe(false);
    expect(link.fileHref).toBeNull();
    expect(link.url).toBe("https://example.com/manual.pdf");

    const note = toAssetEvidenceView(
      evidence({
        kind: "note",
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        capturedText: "Replace with EDR3RXD1",
      }),
      { callerUserId: "user-2", now: NOW },
    );
    expect(note.capturedText).toBe("Replace with EDR3RXD1");
    expect(note.owned).toBe(false);
    expect(note.isImage).toBe(false);
  });

  it("carries per-record scope so a private receipt can show its quiet badge", () => {
    const view = toAssetEvidenceView(evidence({ scope: "household", householdId: "hh-1" }), {
      callerUserId: "user-1",
      now: NOW,
    });
    expect(view.scope).toBe("household");
  });
});
