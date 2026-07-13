import { AssetValidationError } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemoryAssetReviewLifecycleStore } from "./in-memory-review-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAssetReview } from "./review";

const OWNER = "user-1";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";

function setup() {
  const store = createInMemoryAssetReviewLifecycleStore();
  const review = createAssetReview(store);
  const lifecycle = createAssetLifecycle(store);

  const auditKinds = async (assetId: string, ownerUserId = OWNER) =>
    (await lifecycle.listAssetAudit({ ownerUserId, assetId })).map((event) => event.kind);

  function seedAsset(overrides: Partial<Parameters<typeof lifecycle.createAsset>[0]> = {}) {
    return lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator water filter",
      kind: "appliance",
      ...overrides,
    });
  }

  function seedHousehold() {
    return seedHouseholdWithMembers(store, {
      ownerUserId: OWNER,
      members: [
        [OWNER, "owner"],
        [MEMBER, "member"],
      ],
    });
  }

  function seedSource() {
    return store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "New fridge filter is EDR3RXD1, bought Mar 14 for $42.99.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
  }

  /** A pending Suggested Asset group — the destination not yet accepted. */
  async function seedSuggestedGroup(
    overrides: Partial<Parameters<typeof review.suggestAsset>[0]> = {},
  ) {
    const source = await seedSource();
    return review.suggestAsset({
      ownerUserId: OWNER,
      name: "Fridge filter",
      kind: "appliance",
      sourceRecordId: source.id,
      ...overrides,
    });
  }

  /** An existing durable asset plus a memory-only review group anchored to it. */
  async function seedExistingAssetGroup() {
    const asset = await seedAsset();
    const source = await seedSource();
    const result = await review.suggestAssetMemories({
      ownerUserId: OWNER,
      assetId: asset.id,
      sourceRecordId: source.id,
      memories: [{ label: "Warranty ends", value: { type: "date", date: "2027-03-14" } }],
    });
    return { asset, result };
  }

  return {
    store,
    review,
    lifecycle,
    auditKinds,
    seedAsset,
    seedHousehold,
    seedSuggestedGroup,
    seedExistingAssetGroup,
  };
}

// Real JPEG magic bytes — the seam verifies signatures, not just declared types.
const RECEIPT_FILE = {
  fileName: "receipt.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 6,
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]),
};

describe("addAssetEvidence to an existing asset (#200)", () => {
  it("attaches link evidence with metadata, private default scope, and audit provenance", async () => {
    const { review, seedAsset, auditKinds } = setup();
    const asset = await seedAsset();

    const evidence = await review.addAssetEvidence({
      ownerUserId: OWNER,
      assetId: asset.id,
      kind: "link",
      label: "Owner's manual",
      url: "https://example.com/manual.pdf",
    });

    expect(evidence.assetId).toBe(asset.id);
    expect(evidence.kind).toBe("link");
    expect(evidence.scope).toBe("private");
    expect(evidence.reviewGroupId).toBeNull();
    expect(evidence.createdByUserId).toBe(OWNER);

    const listed = await review.listAssetEvidence({ callerUserId: OWNER, assetId: asset.id });
    expect(listed.map((entry) => entry.id)).toEqual([evidence.id]);

    expect(await auditKinds(asset.id)).toContain("evidence_added");
  });

  it("attaches an uploaded receipt with money metadata and stores its bytes", async () => {
    const { review, seedAsset } = setup();
    const asset = await seedAsset();

    const evidence = await review.addAssetEvidence({
      ownerUserId: OWNER,
      assetId: asset.id,
      kind: "receipt",
      label: "Home Depot receipt",
      file: RECEIPT_FILE,
      money: { amount: 42.99, currency: "usd" },
      purchasedOn: "2026-03-14",
    });

    expect(evidence.fileName).toBe("receipt.jpg");
    expect(evidence.sizeBytes).toBe(6);
    expect(evidence.money).toEqual({ amount: 42.99, currency: "USD" });

    const file = await review.getAssetEvidenceFile({
      callerUserId: OWNER,
      evidenceId: evidence.id,
    });
    expect(file?.mimeType).toBe("image/jpeg");
    expect(file?.bytes).toEqual(RECEIPT_FILE.bytes);
  });

  it("rejects an oversized or disallowed upload before anything persists", async () => {
    const { review, seedAsset } = setup();
    const asset = await seedAsset();

    await expect(
      review.addAssetEvidence({
        ownerUserId: OWNER,
        assetId: asset.id,
        kind: "manual",
        label: "Firmware dump",
        file: { ...RECEIPT_FILE, fileName: "dump.zip", mimeType: "application/zip" },
      }),
    ).rejects.toThrow(AssetValidationError);

    expect(await review.listAssetEvidence({ callerUserId: OWNER, assetId: asset.id })).toEqual([]);
  });

  it("rejects mislabeled bytes — the declared type is caller input, the signature is not", async () => {
    const { review, seedAsset } = setup();
    const asset = await seedAsset();

    // Zip bytes wearing an allowed image type: refused before anything persists.
    await expect(
      review.addAssetEvidence({
        ownerUserId: OWNER,
        assetId: asset.id,
        kind: "photo",
        label: "Not actually a photo",
        file: {
          fileName: "photo.png",
          mimeType: "image/png",
          sizeBytes: 8,
          bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]),
        },
      }),
    ).rejects.toThrow(AssetValidationError);

    expect(await review.listAssetEvidence({ callerUserId: OWNER, assetId: asset.id })).toEqual([]);
  });

  it("rejects evidence on an archived asset and denies a missing one deterministically", async () => {
    const { review, lifecycle, seedAsset } = setup();
    const asset = await seedAsset();
    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id });

    await expect(
      review.addAssetEvidence({
        ownerUserId: OWNER,
        assetId: asset.id,
        kind: "link",
        label: "Manual",
        url: "https://example.com/manual",
      }),
    ).rejects.toThrow(AssetValidationError);

    await expect(
      review.addAssetEvidence({
        ownerUserId: OWNER,
        assetId: "missing-asset",
        kind: "link",
        label: "Manual",
        url: "https://example.com/manual",
      }),
    ).rejects.toThrow("Asset not found.");
  });
});

describe("evidence visibility ceilings (#196, #200)", () => {
  /** A household asset carrying one household receipt and one private receipt. */
  async function seedHouseholdEvidence(ctx: ReturnType<typeof setup>) {
    const household = await ctx.seedHousehold();
    const asset = await ctx.seedAsset({ scope: "household", householdId: household.id });

    const householdEvidence = await ctx.review.addAssetEvidence({
      ownerUserId: OWNER,
      assetId: asset.id,
      kind: "receipt",
      label: "Shared receipt",
      file: RECEIPT_FILE,
    });
    const privateEvidence = await ctx.review.addAssetEvidence({
      ownerUserId: OWNER,
      assetId: asset.id,
      kind: "note",
      label: "Private note",
      capturedText: "Bought with the joint gift budget — surprise for Sam.",
      scope: "private",
    });
    return { asset, householdEvidence, privateEvidence };
  }

  it("defaults evidence under a household asset to household scope, private on request", async () => {
    const ctx = setup();
    const { householdEvidence, privateEvidence } = await seedHouseholdEvidence(ctx);

    expect(householdEvidence.scope).toBe("household");
    expect(householdEvidence.householdId).not.toBeNull();
    expect(privateEvidence.scope).toBe("private");
    expect(privateEvidence.householdId).toBeNull();
  });

  it("filters each evidence record independently for a household member", async () => {
    const ctx = setup();
    const { asset, householdEvidence } = await seedHouseholdEvidence(ctx);

    const memberSees = await ctx.review.listAssetEvidence({
      callerUserId: MEMBER,
      assetId: asset.id,
    });
    expect(memberSees.map((entry) => entry.id)).toEqual([householdEvidence.id]);

    const ownerSees = await ctx.review.listAssetEvidence({
      callerUserId: OWNER,
      assetId: asset.id,
    });
    expect(ownerSees).toHaveLength(2);

    expect(
      await ctx.review.listAssetEvidence({ callerUserId: OUTSIDER, assetId: asset.id }),
    ).toEqual([]);
  });

  it("gates file bytes by the record's own visibility, fail-closed", async () => {
    const ctx = setup();
    const { householdEvidence, privateEvidence } = await seedHouseholdEvidence(ctx);

    const memberFile = await ctx.review.getAssetEvidenceFile({
      callerUserId: MEMBER,
      evidenceId: householdEvidence.id,
    });
    expect(memberFile?.bytes).toEqual(RECEIPT_FILE.bytes);

    // The private note has no file; the member also may not see it at all.
    expect(
      await ctx.review.getAssetEvidenceFile({
        callerUserId: MEMBER,
        evidenceId: privateEvidence.id,
      }),
    ).toBeNull();
    expect(
      await ctx.review.getAssetEvidenceFile({
        callerUserId: OUTSIDER,
        evidenceId: householdEvidence.id,
      }),
    ).toBeNull();
  });

  it("rejects evidence broader than its asset — the child-scope ceiling", async () => {
    const ctx = setup();
    const asset = await ctx.seedAsset(); // private

    await expect(
      ctx.review.addAssetEvidence({
        ownerUserId: OWNER,
        assetId: asset.id,
        kind: "photo",
        label: "Serial plate",
        file: RECEIPT_FILE,
        scope: "household",
      }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("keeps removal owner-only even when a member can see the evidence", async () => {
    const ctx = setup();
    const { asset, householdEvidence } = await seedHouseholdEvidence(ctx);

    await expect(
      ctx.review.removeAssetEvidence({ actorUserId: MEMBER, evidenceId: householdEvidence.id }),
    ).rejects.toThrow("Asset evidence not found.");

    await ctx.review.removeAssetEvidence({ actorUserId: OWNER, evidenceId: householdEvidence.id });
    expect(
      (await ctx.review.listAssetEvidence({ callerUserId: MEMBER, assetId: asset.id })).map(
        (entry) => entry.id,
      ),
    ).toEqual([]);
    expect(
      await ctx.review.getAssetEvidenceFile({
        callerUserId: OWNER,
        evidenceId: householdEvidence.id,
      }),
    ).toBeNull();
    expect(await ctx.auditKinds(asset.id)).toContain("evidence_removed");
  });
});

describe("evidence on an asset review group (#200)", () => {
  it("attaches to a still-pending group and rides its review result", async () => {
    const ctx = setup();
    const suggestion = await ctx.seedSuggestedGroup();

    const evidence = await ctx.review.addAssetEvidence({
      ownerUserId: OWNER,
      reviewGroupId: suggestion.group.id,
      kind: "photo",
      label: "Filter label photo",
      file: RECEIPT_FILE,
    });

    expect(evidence.assetId).toBe(suggestion.asset.id);
    expect(evidence.reviewGroupId).toBe(suggestion.group.id);

    const result = await ctx.review.getAssetReviewGroup({
      actorUserId: OWNER,
      groupId: suggestion.group.id,
    });
    expect(result?.evidence.map((entry) => entry.id)).toEqual([evidence.id]);
  });

  it("keeps evidence under a pending anchor out of every visible read until review resolves", async () => {
    const ctx = setup();
    const household = await ctx.seedHousehold();
    const suggestion = await ctx.seedSuggestedGroup({
      scope: "household",
      householdId: household.id,
    });

    const evidence = await ctx.review.addAssetEvidence({
      ownerUserId: OWNER,
      reviewGroupId: suggestion.group.id,
      kind: "receipt",
      label: "Shared receipt",
      file: RECEIPT_FILE,
    });
    expect(evidence.scope).toBe("household");

    // Not even at household scope: the anchor is still a proposal.
    expect(
      await ctx.review.listAssetEvidence({
        callerUserId: MEMBER,
        assetId: suggestion.asset.id,
      }),
    ).toEqual([]);
    expect(
      await ctx.review.getAssetEvidenceFile({ callerUserId: MEMBER, evidenceId: evidence.id }),
    ).toBeNull();

    await ctx.review.acceptSuggestedAsset({ actorUserId: OWNER, assetId: suggestion.asset.id });

    expect(
      (
        await ctx.review.listAssetEvidence({ callerUserId: MEMBER, assetId: suggestion.asset.id })
      ).map((entry) => entry.id),
    ).toEqual([evidence.id]);
  });

  it("attaches to a group anchored on an existing durable asset", async () => {
    const ctx = setup();
    const { asset, result } = await ctx.seedExistingAssetGroup();

    const evidence = await ctx.review.addAssetEvidence({
      ownerUserId: OWNER,
      reviewGroupId: result.group.id,
      kind: "warranty",
      label: "Warranty card",
      file: RECEIPT_FILE,
    });
    expect(evidence.assetId).toBe(asset.id);

    // The durable anchor makes it immediately live on the asset for its owner.
    expect(
      (await ctx.review.listAssetEvidence({ callerUserId: OWNER, assetId: asset.id })).map(
        (entry) => entry.id,
      ),
    ).toEqual([evidence.id]);
  });

  it("refuses evidence on a group whose proposal was dismissed", async () => {
    const ctx = setup();
    const suggestion = await ctx.seedSuggestedGroup();
    await ctx.review.dismissSuggestedAsset({ actorUserId: OWNER, assetId: suggestion.asset.id });

    await expect(
      ctx.review.addAssetEvidence({
        ownerUserId: OWNER,
        reviewGroupId: suggestion.group.id,
        kind: "photo",
        label: "Too late",
        file: RECEIPT_FILE,
      }),
    ).rejects.toThrow(/set aside/i);
  });

  it("re-anchors evidence when duplicate review links to an existing asset, never widening", async () => {
    const ctx = setup();
    const household = await ctx.seedHousehold();
    // The existing asset is private; the proposal argued household.
    const target = await ctx.seedAsset({ name: "Refrigerator water filter" });
    const suggestion = await ctx.seedSuggestedGroup({
      name: "Fridge filter",
      scope: "household",
      householdId: household.id,
    });

    const evidence = await ctx.review.addAssetEvidence({
      ownerUserId: OWNER,
      reviewGroupId: suggestion.group.id,
      kind: "receipt",
      label: "Shared receipt",
      file: RECEIPT_FILE,
    });
    expect(evidence.scope).toBe("household");

    const linked = await ctx.review.linkAssetReviewGroup({
      actorUserId: OWNER,
      groupId: suggestion.group.id,
      targetAssetId: target.id,
    });

    // The evidence now lives on the target, clamped to private (the target's
    // ceiling) — linking never widens who can see a receipt.
    expect(linked.evidence).toHaveLength(1);
    const relinked = linked.evidence[0];
    expect(relinked?.assetId).toBe(target.id);
    expect(relinked?.scope).toBe("private");
    expect(relinked?.householdId).toBeNull();

    expect(
      (await ctx.review.listAssetEvidence({ callerUserId: OWNER, assetId: target.id })).map(
        (entry) => entry.id,
      ),
    ).toEqual([evidence.id]);
    expect(
      await ctx.review.listAssetEvidence({ callerUserId: MEMBER, assetId: target.id }),
    ).toEqual([]);
  });

  it("removes a dismissed proposal's evidence — and its bytes — with the proposal", async () => {
    const ctx = setup();
    const suggestion = await ctx.seedSuggestedGroup();
    const evidence = await ctx.review.addAssetEvidence({
      ownerUserId: OWNER,
      reviewGroupId: suggestion.group.id,
      kind: "photo",
      label: "Filter label photo",
      file: RECEIPT_FILE,
    });

    await ctx.review.dismissSuggestedAsset({ actorUserId: OWNER, assetId: suggestion.asset.id });

    // No orphaned document bucket: the row and its bytes are gone.
    expect(
      await ctx.store.getAssetEvidence({ ownerUserId: OWNER, evidenceId: evidence.id }),
    ).toBeNull();
    expect(
      await ctx.review.getAssetEvidenceFile({ callerUserId: OWNER, evidenceId: evidence.id }),
    ).toBeNull();
    expect(await ctx.auditKinds(suggestion.asset.id)).toContain("evidence_removed");
  });

  it("keeps evidence when dismissing details grouped under an existing durable asset", async () => {
    const ctx = setup();
    const { asset, result } = await ctx.seedExistingAssetGroup();
    const evidence = await ctx.review.addAssetEvidence({
      ownerUserId: OWNER,
      reviewGroupId: result.group.id,
      kind: "warranty",
      label: "Warranty card",
      file: RECEIPT_FILE,
    });

    await ctx.review.dismissAssetReviewGroup({ actorUserId: OWNER, groupId: result.group.id });

    // The rejected suggestion goes; the deliberately captured evidence stays on
    // the real asset it was uploaded to.
    expect(
      (await ctx.review.listAssetEvidence({ callerUserId: OWNER, assetId: asset.id })).map(
        (entry) => entry.id,
      ),
    ).toEqual([evidence.id]);
  });

  it("requires exactly one attachment target", async () => {
    const ctx = setup();
    const asset = await ctx.seedAsset();
    const suggestion = await ctx.seedSuggestedGroup();

    await expect(
      ctx.review.addAssetEvidence({
        ownerUserId: OWNER,
        assetId: asset.id,
        reviewGroupId: suggestion.group.id,
        kind: "photo",
        label: "Both targets",
        file: RECEIPT_FILE,
      }),
    ).rejects.toThrow(AssetValidationError);

    await expect(
      ctx.review.addAssetEvidence({
        ownerUserId: OWNER,
        kind: "photo",
        label: "No target",
        file: RECEIPT_FILE,
      }),
    ).rejects.toThrow(AssetValidationError);
  });
});

describe("addAssetEvidenceToNewAsset (#201)", () => {
  it("opens a review-gated Suggested Asset and attaches the capture to its group", async () => {
    const { review, auditKinds } = setup();

    const { evidence, group } = await review.addAssetEvidenceToNewAsset({
      ownerUserId: OWNER,
      asset: { name: "Dishwasher", kind: "appliance" },
      kind: "receipt",
      label: "Home Depot receipt",
      file: RECEIPT_FILE,
      money: { amount: 42.99, currency: "usd" },
    });

    // Review-gated write: the new destination is a pending proposal, never a
    // silently-created active asset (#196 story 26).
    expect(group.asset.status).toBe("suggested");
    expect(group.assetPending).toBe(true);
    expect(group.asset.name).toBe("Dishwasher");

    // The capture rides the proposal's review group through the shared path.
    expect(evidence.assetId).toBe(group.asset.id);
    expect(evidence.reviewGroupId).toBe(group.group.id);
    expect(evidence.money).toEqual({ amount: 42.99, currency: "USD" });

    // The proposal is in the owner's Review Queue with its evidence in view.
    const pending = await review.listAssetReviewGroups({ ownerUserId: OWNER });
    expect(pending.map((entry) => entry.group.id)).toContain(group.group.id);
    expect(pending[0]?.evidence.map((entry) => entry.id)).toEqual([evidence.id]);

    expect(await auditKinds(group.asset.id)).toEqual(
      expect.arrayContaining(["suggested", "evidence_added"]),
    );
  });

  it("rejects mislabeled bytes before anything persists — no half-created proposal", async () => {
    const { review } = setup();

    await expect(
      review.addAssetEvidenceToNewAsset({
        ownerUserId: OWNER,
        asset: { name: "Dishwasher", kind: "appliance" },
        kind: "photo",
        label: "Not really a JPEG",
        file: {
          fileName: "receipt.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 4,
          bytes: new Uint8Array([0x00, 0x01, 0x02, 0x03]),
        },
      }),
    ).rejects.toThrow(AssetValidationError);

    // The vet runs before the proposal opens: no Suggested Asset husk, no group.
    expect(await review.listAssetReviewGroups({ ownerUserId: OWNER })).toEqual([]);
  });

  it("keeps the proposal and its evidence private until acceptance widens them", async () => {
    const { review } = setup();

    const { evidence, group } = await review.addAssetEvidenceToNewAsset({
      ownerUserId: OWNER,
      asset: { name: "Espresso machine", kind: "appliance" },
      kind: "photo",
      label: "Serial plate",
      file: RECEIPT_FILE,
    });

    // The proposal argues private; a wider audience is a review-time decision.
    expect(group.asset.scope).toBe("private");
    expect(evidence.scope).toBe("private");
    expect(evidence.householdId).toBeNull();
  });
});

describe("listAssetEvidenceCaptureTargets (#201)", () => {
  it("offers only the owner's own active assets and still-open review groups", async () => {
    const ctx = setup();

    // The owner's own active asset: offered.
    const mine = await ctx.seedAsset({ name: "Refrigerator" });
    // The owner's archived asset: read-only history, never a capture target.
    const retired = await ctx.seedAsset({ name: "Old dryer" });
    await ctx.lifecycle.archiveAsset({ actorUserId: OWNER, assetId: retired.id });
    // A co-member's household asset the owner can SEE but does not own:
    // capture is an owner act (the profile's gate), so it is not offered.
    const household = await ctx.seedHousehold();
    await ctx.lifecycle.createAsset({
      ownerUserId: MEMBER,
      name: "Shared TV",
      kind: "appliance",
      scope: "household",
      householdId: household.id,
    });

    // One still-open review group, and one that review has since resolved.
    const open = await ctx.seedSuggestedGroup({ name: "Fridge filter" });
    const resolved = await ctx.seedSuggestedGroup({ name: "Espresso machine" });
    await ctx.review.acceptAssetReviewGroup({ actorUserId: OWNER, groupId: resolved.group.id });

    const targets = await ctx.review.listAssetEvidenceCaptureTargets({ ownerUserId: OWNER });

    // Owned + active only — the accepted proposal is now a durable asset and
    // moves from the review list to the asset list.
    expect(targets.assets.map((asset) => asset.name).sort()).toEqual([
      "Espresso machine",
      "Refrigerator",
    ]);
    expect(targets.assets.map((asset) => asset.id)).toContain(mine.id);
    expect(targets.assets.every((asset) => asset.ownerUserId === OWNER)).toBe(true);

    // Only the still-open group remains a review destination, with its anchor.
    expect(targets.reviews.map((entry) => entry.groupId)).toEqual([open.group.id]);
    expect(targets.reviews[0]?.asset.name).toBe("Fridge filter");
  });
});
