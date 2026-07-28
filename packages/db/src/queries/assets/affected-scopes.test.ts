import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryAssetStore } from "./in-memory-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAffectedAssetLifecycle } from "./mutation-lifecycle";
import {
  assetAndGeneralActionMutationOutcome,
  assetIdsMutationOutcome,
  reviewMutationOutcome,
} from "./mutation-outcomes";
import type { AssetReviewGroupResult } from "./review-types";

const OWNER = "owner-1";

describe("Asset affected-scope contract", () => {
  it("routes the production Asset lifecycle through the affected-scope seam", () => {
    // There is no live Drizzle adapter harness, so the production half of this
    // store contract is a source-wiring guard; behavior runs in memory below.
    const source = readFileSync(join(import.meta.dirname, "..", "assets.ts"), "utf8");
    expect(source).toContain(
      "createAffectedAssetLifecycle(\n  createAssetLifecycle(createDrizzleAssetLifecycleStore()",
    );
    for (const mutation of [
      "suggestAsset",
      "suggestAssetMemories",
      "createActiveAssetMemory",
      "promoteGeneralActionAssetHint",
      "proposeAssetMemoryActions",
      "addAssetEvidence",
      "addAssetEvidenceToNewAsset",
      "removeAssetEvidence",
      "acceptSuggestedAssetLink",
      "dismissSuggestedAssetLink",
      "removeAssetLink",
      "addAssetPersonLink",
      "removeAssetPersonLink",
    ]) {
      expect(source).toMatch(
        new RegExp(
          `export async function ${mutation}[\\s\\S]*?(?:reviewMutationOutcome|assetIdsMutationOutcome|affectedScopes:)`,
          "m",
        ),
      );
    }
  });

  it("returns scopes for review, evidence/link, and Action-proposal satellite contracts", async () => {
    const asset = { id: "asset-1", ownerUserId: OWNER };
    const review = await reviewMutationOutcome(
      Promise.resolve({ asset } as unknown as AssetReviewGroupResult),
    );
    expect(review.affectedScopes).toEqual(
      expect.arrayContaining([
        { kind: "viewer-entity", entity: "asset", entityId: "asset-1", viewerUserId: OWNER },
        { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
      ]),
    );

    const satelliteCases = [
      { name: "memory/evidence/person link", result: { assetId: "asset-1" }, ids: ["asset-1"] },
      {
        name: "related Asset link",
        result: { fromAssetId: "asset-1", toAssetId: "asset-2" },
        ids: ["asset-1", "asset-2"],
      },
      {
        name: "new-Asset evidence",
        result: { evidence: { assetId: "asset-1" }, group: { asset: { id: "asset-2" } } },
        ids: ["asset-1", "asset-2"],
      },
    ];
    for (const satellite of satelliteCases) {
      const outcome = await assetIdsMutationOutcome(
        Promise.resolve(satellite.result),
        OWNER,
        () => satellite.ids,
      );
      for (const assetId of satellite.ids) {
        expect(outcome.affectedScopes, satellite.name).toContainEqual({
          kind: "viewer-entity",
          entity: "asset",
          entityId: assetId,
          viewerUserId: OWNER,
        });
      }
    }

    const proposal = await assetAndGeneralActionMutationOutcome(
      Promise.resolve({ asset, actionIds: ["action-1", "action-2"] }),
      {
        ownerUserId: OWNER,
        asset: (result) => result.asset,
        generalActionIds: (result) => result.actionIds,
      },
    );
    expect(proposal.affectedScopes).toEqual(
      expect.arrayContaining([
        {
          kind: "viewer-entity",
          entity: "general-action",
          entityId: "action-1",
          viewerUserId: OWNER,
        },
        {
          kind: "viewer-entity",
          entity: "general-action",
          entityId: "action-2",
          viewerUserId: OWNER,
        },
      ]),
    );
  });

  it("returns Asset, linked Action, Today, and Review scopes for every lifecycle write", async () => {
    const lifecycle = createAffectedAssetLifecycle(
      createAssetLifecycle(createInMemoryAssetStore()),
    );
    const created = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Kitchen refrigerator",
      kind: "appliance",
    });

    expect(created.affectedScopes).toEqual(
      expect.arrayContaining([
        { kind: "owner-collection", collection: "assets", ownerUserId: OWNER },
        { kind: "viewer-collection", collection: "assets", viewerUserId: OWNER },
        {
          kind: "viewer-entity",
          entity: "asset",
          entityId: created.result.id,
          viewerUserId: OWNER,
        },
        { kind: "visible-entity", entity: "asset", entityId: created.result.id },
        { kind: "linked-entity", entity: "asset", entityId: created.result.id },
        { kind: "owner-collection", collection: "today", ownerUserId: OWNER },
        { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
      ]),
    );

    const edited = await lifecycle.editAsset({
      actorUserId: OWNER,
      assetId: created.result.id,
      edit: { name: "Garage refrigerator" },
    });
    expect(edited.affectedScopes).toEqual(created.affectedScopes);

    const archived = await lifecycle.archiveAsset({
      actorUserId: OWNER,
      assetId: created.result.id,
    });
    expect(archived.affectedScopes).toEqual(created.affectedScopes);

    const restored = await lifecycle.restoreAsset({
      actorUserId: OWNER,
      assetId: created.result.id,
    });
    expect(restored.affectedScopes).toEqual(created.affectedScopes);

    const deleted = await lifecycle.hardDeleteAsset({
      actorUserId: OWNER,
      assetId: created.result.id,
    });
    expect(deleted.result).toBeUndefined();
    expect(deleted.affectedScopes).toEqual(created.affectedScopes);
  });
});
