import type { CreateAssetInput } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryAssetStore } from "./in-memory-store";
import type { AssetStore } from "./types";

const OWNER = "user-1";

/**
 * Behavioral contract every `AssetStore` must satisfy, so both the in-memory and
 * drizzle stores back the surface identically. Run against the in-memory store
 * directly here; the drizzle store — which has no live-DB harness in this
 * package — is guarded to the same behaviors by `drizzle-store.test.ts` (the
 * defaults-free update parse, the name ordering, and the shared scope predicate).
 * The two together keep the stores from diverging, mirroring the General Action
 * store-contract convention.
 */
function runStoreContract(name: string, makeStore: () => AssetStore) {
  describe(`${name} store contract`, () => {
    function seed(store: AssetStore, overrides: Partial<CreateAssetInput> = {}) {
      return store.createAsset({
        ownerUserId: OWNER,
        name: "Refrigerator water filter",
        kind: "appliance",
        status: "active",
        scope: "private",
        householdId: null,
        archivedAt: null,
        createdByUserId: OWNER,
        lastActorUserId: OWNER,
        ...overrides,
      });
    }

    it("a status-only update leaves untouched columns intact (no default wipe)", async () => {
      const store = makeStore();
      const asset = await seed(store);

      const updated = await store.updateAsset({
        ownerUserId: OWNER,
        assetId: asset.id,
        patch: { status: "archived", archivedAt: new Date("2026-07-01T00:00:00Z") },
      });

      expect(updated.status).toBe("archived");
      expect(updated.name).toBe("Refrigerator water filter");
      expect(updated.kind).toBe("appliance");
      expect(updated.scope).toBe("private");
      expect(updated.createdByUserId).toBe(OWNER);
    });

    it("orders listings by case-insensitive name, newest first on ties", async () => {
      const store = makeStore();
      await seed(store, { name: "zebra print blanket", kind: "item" });
      await seed(store, { name: "Air purifier" });
      await seed(store, { name: "corolla", kind: "vehicle" });

      const listed = await store.listVisibleAssetsForCaller({ callerUserId: OWNER });
      expect(listed.map((asset) => asset.name)).toEqual([
        "Air purifier",
        "corolla",
        "zebra print blanket",
      ]);
    });

    it("owner-keys single reads and updates", async () => {
      const store = makeStore();
      const asset = await seed(store);

      await expect(
        store.getAsset({ ownerUserId: "someone-else", assetId: asset.id }),
      ).resolves.toBeNull();
      await expect(
        store.updateAsset({
          ownerUserId: "someone-else",
          assetId: asset.id,
          patch: { name: "Hijacked" },
        }),
      ).rejects.toThrow("Asset not found.");
    });

    it("owner-keys the audit trail read", async () => {
      const store = makeStore();
      const asset = await seed(store);
      await store.createAssetAuditEvent({
        assetId: asset.id,
        ownerUserId: OWNER,
        kind: "created",
        actorUserId: OWNER,
        source: "user",
        scope: "private",
        detailJson: {},
      });

      await expect(
        store.listAssetAuditEvents({ ownerUserId: "someone-else", assetId: asset.id }),
      ).resolves.toEqual([]);
      await expect(
        store.listAssetAuditEvents({ ownerUserId: OWNER, assetId: asset.id }),
      ).resolves.toHaveLength(1);
    });
  });
}

runStoreContract("in-memory", () => createInMemoryAssetStore());
