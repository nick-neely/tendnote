import { describe, expect, it } from "vitest";
import type { OwnerDataExportActionsPlanningContext } from "./actions-planning";
import { readStoredZipEntries, readStoredZipEntryBytes } from "./archive-reader";
import type { OwnerDataExportAssetsContext } from "./assets";
import { generateOwnerDataExportArchive } from "./generator";
import type { OwnerDataExportRelationshipContext } from "./relationship-context";

const ACCOUNT = {
  id: "owner-1",
  name: "Owner Example",
  email: "owner@example.com",
  accessStatus: "granted" as const,
  accessSource: "self_hosted_bootstrap",
  grantedAt: new Date("2026-08-19T12:00:00.000Z"),
};

const NOW = new Date("2026-08-19T12:00:00.000Z");
const EXPIRES = new Date("2026-08-20T12:00:00.000Z");

function date(value: string) {
  return new Date(value);
}

function emptyRelationshipContext(): OwnerDataExportRelationshipContext {
  return {
    people: [
      {
        id: "person-owned",
        ownerUserId: "owner-1",
        displayName: "Ada Lovelace",
        firstName: "Ada",
        lastName: "Lovelace",
        birthday: null,
        relationshipType: "friend",
        closenessLevel: 2,
        profileBlurb: null,
        source: "manual",
        createdAt: date("2026-08-01T12:00:00.000Z"),
        updatedAt: date("2026-08-02T12:00:00.000Z"),
      },
    ],
    contactMethods: [],
    memories: [],
    sourceRecords: [
      {
        id: "source-owned",
        ownerUserId: "owner-1",
        householdId: null,
        sourceType: "manual",
        content: "The refrigerator filter is a 4-inch cartridge.",
        rawContent: null,
        retentionPolicy: "retain",
        status: "active",
        confidence: "high",
        sensitivity: "restricted",
        scope: "private",
        importance: 3,
        metadataJson: {},
        createdAt: date("2026-08-03T12:00:00.000Z"),
        updatedAt: date("2026-08-04T12:00:00.000Z"),
      },
    ],
    sourceRecordPeople: [],
    unresolvedMentions: [],
    interactions: [],
    followups: [],
    contextFacts: [],
  };
}

function emptyActionsContext(): OwnerDataExportActionsPlanningContext {
  return {
    generalActions: [],
    generalActionAreas: [],
    generalActionPeople: [],
    generalActionAssets: [],
    generalActionEvents: [],
    savedItems: [],
    savedItemEvents: [],
    savedItemOutcomes: [],
    messageDrafts: [],
    giftPlans: [],
    giftIdeas: [],
    giftPlanEvents: [],
    recordShares: [],
    sourceRecordIds: ["source-owned"],
    personIds: ["person-owned"],
    memoryIds: [],
    followupIds: [],
  };
}

function assetsContext(): OwnerDataExportAssetsContext {
  const createdAt = date("2026-08-05T12:00:00.000Z");
  const updatedAt = date("2026-08-18T12:00:00.000Z");
  return {
    assets: [
      {
        id: "asset-owned",
        ownerUserId: "owner-1",
        name: "Kitchen Refrigerator",
        kind: "appliance",
        status: "archived",
        scope: "shared",
        ownership: "member_owned",
        householdId: "household-1",
        archivedAt: updatedAt,
        revision: 4,
        createdByUserId: "owner-1",
        lastActorUserId: "owner-1",
        createdAt,
        updatedAt,
      },
      {
        id: "asset-owned-suggested",
        ownerUserId: "owner-1",
        name: "Replacement Filter",
        kind: "item",
        status: "suggested",
        scope: "private",
        ownership: "member_owned",
        householdId: null,
        archivedAt: null,
        revision: 0,
        createdByUserId: "owner-1",
        lastActorUserId: null,
        createdAt,
        updatedAt,
      },
      {
        id: "asset-other-owner",
        ownerUserId: "owner-2",
        name: "Other Owner Vehicle",
        kind: "vehicle",
        status: "active",
        scope: "shared",
        ownership: "member_owned",
        householdId: "household-1",
        archivedAt: null,
        revision: 0,
        createdByUserId: "owner-2",
        lastActorUserId: "owner-2",
        createdAt,
        updatedAt,
      },
      {
        id: "asset-household-native",
        ownerUserId: "owner-1",
        name: "Household Furnace",
        kind: "appliance",
        status: "active",
        scope: "household",
        ownership: "household_native",
        householdId: "household-1",
        archivedAt: null,
        revision: 2,
        createdByUserId: "owner-1",
        lastActorUserId: "owner-2",
        createdAt,
        updatedAt,
      },
    ],
    assetMemories: [
      {
        id: "memory-owned",
        assetId: "asset-owned",
        ownerUserId: "owner-1",
        status: "active",
        label: "Filter size",
        value: { type: "text", text: "4 inch" },
        notes: "Replace twice a year.",
        scope: "private",
        ownership: "member_owned",
        householdId: null,
        revision: 3,
        sourceRecordId: "source-owned",
        reviewGroupId: null,
        createdByUserId: "owner-1",
        lastActorUserId: "owner-1",
        createdAt,
        updatedAt,
      },
      {
        id: "memory-household-native",
        assetId: "asset-household-native",
        ownerUserId: "owner-1",
        status: "active",
        label: "Furnace model",
        value: { type: "text", text: "EXCLUDE-ME" },
        notes: null,
        scope: "household",
        ownership: "household_native",
        householdId: "household-1",
        revision: 0,
        sourceRecordId: null,
        reviewGroupId: null,
        createdByUserId: "owner-1",
        lastActorUserId: "owner-1",
        createdAt,
        updatedAt,
      },
      {
        id: "memory-other-owner",
        assetId: "asset-owned",
        ownerUserId: "owner-2",
        status: "dismissed",
        label: "Private detail",
        value: { type: "text", text: "EXCLUDE-ME" },
        notes: null,
        scope: "private",
        ownership: "member_owned",
        householdId: null,
        revision: 1,
        sourceRecordId: null,
        reviewGroupId: null,
        createdByUserId: "owner-2",
        lastActorUserId: "owner-2",
        createdAt,
        updatedAt,
      },
    ],
    assetEvidence: [
      {
        id: "evidence-owned",
        assetId: "asset-owned",
        ownerUserId: "owner-1",
        kind: "manual",
        label: "Filter manual",
        fileName: "../manuals/filter/manual.pdf",
        mimeType: "application/pdf",
        sizeBytes: 8,
        url: null,
        capturedText: "Keep the filter dry.",
        money: null,
        purchasedOn: "2026-08-01",
        renewsOn: null,
        scope: "private",
        ownership: "member_owned",
        householdId: null,
        sourceRecordId: "source-owned",
        reviewGroupId: null,
        createdByUserId: "owner-1",
        lastActorUserId: "owner-1",
        createdAt,
        updatedAt,
      },
      {
        id: "evidence-note-owned",
        assetId: "asset-owned",
        ownerUserId: "owner-1",
        kind: "note",
        label: "Install note",
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        url: null,
        capturedText: "Turn off water first.",
        money: null,
        purchasedOn: null,
        renewsOn: null,
        scope: "private",
        ownership: "member_owned",
        householdId: null,
        sourceRecordId: null,
        reviewGroupId: null,
        createdByUserId: "owner-1",
        lastActorUserId: "owner-1",
        createdAt,
        updatedAt,
      },
      {
        id: "evidence-household-native",
        assetId: "asset-household-native",
        ownerUserId: "owner-1",
        kind: "photo",
        label: "EXCLUDE-ME",
        fileName: "furnace.png",
        mimeType: "image/png",
        sizeBytes: 3,
        url: null,
        capturedText: null,
        money: null,
        purchasedOn: null,
        renewsOn: null,
        scope: "household",
        ownership: "household_native",
        householdId: "household-1",
        sourceRecordId: null,
        reviewGroupId: null,
        createdByUserId: "owner-1",
        lastActorUserId: "owner-2",
        createdAt,
        updatedAt,
      },
      {
        id: "evidence-other-owner",
        assetId: "asset-owned",
        ownerUserId: "owner-2",
        kind: "receipt",
        label: "EXCLUDE-ME",
        fileName: "other.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        url: null,
        capturedText: null,
        money: null,
        purchasedOn: null,
        renewsOn: null,
        scope: "shared",
        ownership: "member_owned",
        householdId: "household-1",
        sourceRecordId: null,
        reviewGroupId: null,
        createdByUserId: "owner-2",
        lastActorUserId: "owner-2",
        createdAt,
        updatedAt,
      },
    ],
    assetEvidenceFiles: [
      {
        evidenceId: "evidence-owned",
        ownerUserId: "owner-1",
        bytes: new Uint8Array([0, 1, 2, 3, 255, 254, 0, 9]),
      },
      {
        evidenceId: "evidence-household-native",
        ownerUserId: "owner-1",
        bytes: new Uint8Array([8, 8, 8]),
      },
      {
        evidenceId: "evidence-other-owner",
        ownerUserId: "owner-2",
        bytes: new Uint8Array([7, 7, 7]),
      },
    ],
    assetLinks: [
      {
        id: "asset-link-owned",
        ownerUserId: "owner-1",
        fromAssetId: "asset-owned-suggested",
        toAssetId: "asset-owned",
        relation: "fits",
        status: "active",
        sourceRecordId: "source-owned",
        createdAt,
        updatedAt,
      },
      {
        id: "asset-link-foreign",
        ownerUserId: "owner-1",
        fromAssetId: "asset-owned",
        toAssetId: "asset-other-owner",
        relation: "replaces",
        status: "dismissed",
        sourceRecordId: null,
        createdAt,
        updatedAt,
      },
    ],
    assetPersonLinks: [
      {
        id: "asset-person-owned",
        ownerUserId: "owner-1",
        assetId: "asset-owned",
        personId: "person-owned",
        relation: "services",
        createdAt,
      },
      {
        id: "asset-person-foreign",
        ownerUserId: "owner-1",
        assetId: "asset-owned",
        personId: "person-other-owner",
        relation: "knows_about",
        createdAt,
      },
    ],
    sensitivityByRecordId: { "source-owned": "restricted" },
  };
}

function jsonResource(entries: Map<string, string>, path: string) {
  const parsed = JSON.parse(entries.get(path) ?? "null") as { records: unknown[] } | null;
  if (!parsed) throw new Error(`Missing ${path}`);
  return parsed.records;
}

describe("owner asset and evidence export", () => {
  it("exports the exact owner graph with restricted labels and byte-faithful evidence", async () => {
    const result = await generateOwnerDataExportArchive({
      ownerUserId: "owner-1",
      account: ACCOUNT,
      now: NOW,
      expiresAt: EXPIRES,
      relationshipContext: emptyRelationshipContext(),
      actionsPlanningContext: emptyActionsContext(),
      assetsContext: assetsContext(),
    });
    const entries = readStoredZipEntries(result.bytes);
    const assets = jsonResource(entries, "resources/assets/assets-v1.json");
    const memories = jsonResource(entries, "resources/assets/asset-memories-v1.json");
    const evidence = jsonResource(entries, "resources/assets/asset-evidence-v1.json");

    expect(assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "asset-owned", status: "archived", sensitivity: "normal" }),
        expect.objectContaining({ id: "asset-owned-suggested", status: "suggested" }),
      ]),
    );
    expect(assets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "asset-other-owner" })]),
    );
    expect(assets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "asset-household-native" })]),
    );
    expect(memories).toEqual([
      expect.objectContaining({
        id: "memory-owned",
        assetId: "asset-owned",
        value: { type: "text", text: "4 inch" },
        sensitivity: "restricted",
      }),
    ]);
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "evidence-owned",
          filePath: "resources/assets/evidence/evidence-owned/manual.pdf",
          sensitivity: "restricted",
          sizeBytes: 8,
        }),
        expect.objectContaining({ id: "evidence-note-owned", filePath: null }),
      ]),
    );
    expect(evidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "evidence-household-native" })]),
    );
    expect(evidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "evidence-other-owner" })]),
    );
    expect(
      readStoredZipEntryBytes(result.bytes, "resources/assets/evidence/evidence-owned/manual.pdf"),
    ).toEqual(new Uint8Array([0, 1, 2, 3, 255, 254, 0, 9]));
    expect(jsonResource(entries, "resources/assets/asset-links-v1.json")).toEqual([
      expect.objectContaining({
        id: "asset-link-owned",
        fromAssetId: "asset-owned-suggested",
        toAssetId: "asset-owned",
      }),
    ]);
    expect(jsonResource(entries, "resources/assets/asset-person-links-v1.json")).toEqual([
      expect.objectContaining({ id: "asset-person-owned", personId: "person-owned" }),
    ]);

    const manifest = JSON.parse(entries.get("manifest.json") ?? "null") as {
      includedFamilies: string[];
      resources: Array<{
        path: string;
        recordCount?: number;
        byteCount?: number;
        sensitivity?: string;
      }>;
    };
    expect(manifest.includedFamilies).toEqual(
      expect.arrayContaining(["Assets", "Asset Memories", "Asset Evidence"]),
    );
    expect(manifest.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "resources/assets/asset-evidence-v1.json",
          recordCount: 2,
          sensitivity: "restricted",
        }),
        expect.objectContaining({
          path: "resources/assets/evidence/evidence-owned/manual.pdf",
          recordCount: 1,
          byteCount: 8,
          sensitivity: "restricted",
        }),
      ]),
    );
    expect(entries.get("inventory.txt")).toContain("Asset Evidence");
    expect(new TextDecoder().decode(result.bytes)).not.toContain("EXCLUDE-ME");
  });

  it("fails closed when owner evidence metadata has no matching stored bytes", async () => {
    const context = assetsContext();
    context.assetEvidenceFiles = context.assetEvidenceFiles.filter(
      (file) => file.evidenceId !== "evidence-owned",
    );
    await expect(
      generateOwnerDataExportArchive({
        ownerUserId: "owner-1",
        account: ACCOUNT,
        now: NOW,
        expiresAt: EXPIRES,
        relationshipContext: emptyRelationshipContext(),
        assetsContext: context,
      }),
    ).rejects.toThrow("evidence-owned");
  });

  it("fails closed for empty or malformed file metadata", async () => {
    const context = assetsContext();
    const evidence = context.assetEvidence[0];
    if (!evidence) throw new Error("Expected fixture evidence.");
    context.assetEvidence[0] = { ...evidence, fileName: "   " };

    await expect(
      generateOwnerDataExportArchive({
        ownerUserId: "owner-1",
        account: ACCOUNT,
        now: NOW,
        expiresAt: EXPIRES,
        relationshipContext: emptyRelationshipContext(),
        assetsContext: context,
      }),
    ).rejects.toThrow("empty file name");
  });

  it("uses the evidence id to keep unsafe or colliding file names deterministic", async () => {
    const context = assetsContext();
    const firstEvidence = context.assetEvidence[0];
    if (!firstEvidence) throw new Error("Expected evidence fixture.");
    context.assetEvidence.push({
      ...firstEvidence,
      id: "evidence-collision",
      label: "Second manual",
      fileName: "manual.pdf",
      sizeBytes: 2,
      sourceRecordId: null,
    });
    context.assetEvidenceFiles.push({
      evidenceId: "evidence-collision",
      ownerUserId: "owner-1",
      bytes: new Uint8Array([4, 5]),
    });
    const result = await generateOwnerDataExportArchive({
      ownerUserId: "owner-1",
      account: ACCOUNT,
      now: NOW,
      expiresAt: EXPIRES,
      relationshipContext: emptyRelationshipContext(),
      assetsContext: context,
    });
    const entries = readStoredZipEntries(result.bytes);
    const evidence = jsonResource(entries, "resources/assets/asset-evidence-v1.json");
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "evidence-owned",
          filePath: "resources/assets/evidence/evidence-owned/manual.pdf",
        }),
        expect.objectContaining({
          id: "evidence-collision",
          filePath: "resources/assets/evidence/evidence-collision/manual.pdf",
        }),
      ]),
    );
    expect(
      readStoredZipEntryBytes(
        result.bytes,
        "resources/assets/evidence/evidence-collision/manual.pdf",
      ),
    ).toEqual(new Uint8Array([4, 5]));
  });

  it("labels directly grounded Asset records even without a source-record link", async () => {
    const context = assetsContext();
    context.sensitivityByRecordId = {
      ...context.sensitivityByRecordId,
      "asset-owned": "restricted",
    };
    const result = await generateOwnerDataExportArchive({
      ownerUserId: "owner-1",
      account: ACCOUNT,
      now: NOW,
      expiresAt: EXPIRES,
      relationshipContext: emptyRelationshipContext(),
      assetsContext: context,
    });
    const assets = jsonResource(
      readStoredZipEntries(result.bytes),
      "resources/assets/assets-v1.json",
    );
    expect(assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "asset-owned", sensitivity: "restricted" }),
      ]),
    );
  });
});
