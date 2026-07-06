import type { CreateGeneralActionAreaInput } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryGeneralActionAreaStore } from "./in-memory-store";
import type { GeneralActionAreaStore } from "./types";

const OWNER = "user-1";

/**
 * Behavioral contract every `GeneralActionAreaStore` must satisfy so the in-memory
 * and drizzle stores back the filter and picker identically. It runs against the
 * in-memory store directly; the drizzle store — which has no live-DB harness in this
 * package — is guarded to the same two behaviors by `drizzle-store.test.ts` (parse
 * update patches with the defaults-free schema, order by sortOrder then name).
 */
function runStoreContract(name: string, makeStore: () => GeneralActionAreaStore) {
  describe(`${name} area store contract`, () => {
    function seed(
      store: GeneralActionAreaStore,
      overrides: Partial<CreateGeneralActionAreaInput> = {},
    ) {
      return store.createArea({
        ownerUserId: OWNER,
        name: "Home",
        sortOrder: 0,
        archivedAt: null,
        ...overrides,
      });
    }

    it("createAreas inserts many and skips ones colliding with an active name", async () => {
      const store = makeStore();
      await seed(store, { name: "Home", sortOrder: 0 });

      const created = await store.createAreas({
        areas: [
          { ownerUserId: OWNER, name: "Health", sortOrder: 1, archivedAt: null },
          // "home" collides case-insensitively with the existing active "Home".
          { ownerUserId: OWNER, name: "home", sortOrder: 2, archivedAt: null },
        ],
      });

      expect(created.map((area) => area.name)).toEqual(["Health"]);
      await expect(store.listAreasForOwner({ ownerUserId: OWNER })).resolves.toHaveLength(2);
    });

    it("orders by sortOrder ascending, then name", async () => {
      const store = makeStore();
      await seed(store, { name: "Travel", sortOrder: 2 });
      await seed(store, { name: "Home", sortOrder: 0 });
      await seed(store, { name: "Health", sortOrder: 1 });
      await seed(store, { name: "Admin", sortOrder: 1 });

      const listed = await store.listAreasForOwner({ ownerUserId: OWNER });

      // sortOrder wins; within the same sortOrder, name breaks the tie.
      expect(listed.map((area) => area.name)).toEqual(["Home", "Admin", "Health", "Travel"]);
    });

    it("excludes archived areas by default and includes them when asked", async () => {
      const store = makeStore();
      const active = await seed(store, { name: "Home", sortOrder: 0 });
      const retired = await seed(store, { name: "Old", sortOrder: 1 });
      await store.updateArea({
        ownerUserId: OWNER,
        areaId: retired.id,
        patch: { archivedAt: new Date("2026-07-01T00:00:00Z") },
      });

      await expect(store.listAreasForOwner({ ownerUserId: OWNER })).resolves.toMatchObject([
        { id: active.id },
      ]);
      await expect(
        store.listAreasForOwner({ ownerUserId: OWNER, includeArchived: true }),
      ).resolves.toHaveLength(2);
    });

    it("a rename leaves untouched columns intact (no default wipe)", async () => {
      const store = makeStore();
      const archived = await seed(store, { name: "Home", sortOrder: 3 });
      await store.updateArea({
        ownerUserId: OWNER,
        areaId: archived.id,
        patch: { archivedAt: new Date("2026-07-01T00:00:00Z") },
      });

      const renamed = await store.updateArea({
        ownerUserId: OWNER,
        areaId: archived.id,
        patch: { name: "House" },
      });

      expect(renamed.name).toBe("House");
      // The rename must not clear archivedAt or reset sortOrder.
      expect(renamed.archivedAt?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(renamed.sortOrder).toBe(3);
    });

    it("scopes reads and updates to the owner", async () => {
      const store = makeStore();
      const area = await seed(store);

      await expect(store.getArea({ ownerUserId: "user-2", areaId: area.id })).resolves.toBeNull();
      await expect(
        store.updateArea({ ownerUserId: "user-2", areaId: area.id, patch: { name: "Nope" } }),
      ).rejects.toThrow();
      await expect(store.listAreasForOwner({ ownerUserId: "user-2" })).resolves.toEqual([]);
    });
  });
}

runStoreContract("in-memory", createInMemoryGeneralActionAreaStore);
