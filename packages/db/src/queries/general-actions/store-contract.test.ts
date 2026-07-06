import type { CreateGeneralActionInput } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryGeneralActionStore } from "./in-memory-store";
import type { GeneralActionStore } from "./types";

const OWNER = "user-1";

/**
 * Behavioral contract every `GeneralActionStore` must satisfy, so both the
 * in-memory and drizzle stores back the surface identically. It is run against the
 * in-memory store directly here; the drizzle store — which has no live-DB harness
 * in this package — is guarded to the same two behaviors by `drizzle-store.test.ts`
 * (it must parse update patches with the defaults-free schema and order by the same
 * surfacing-time expression). The two together keep the stores from diverging.
 */
function runStoreContract(name: string, makeStore: () => GeneralActionStore) {
  describe(`${name} store contract`, () => {
    function seed(store: GeneralActionStore, overrides: Partial<CreateGeneralActionInput> = {}) {
      return store.createGeneralAction({
        ownerUserId: OWNER,
        title: "Replace the water filter",
        notes: "Model MWF",
        links: [{ url: "https://example.com/filter" }],
        status: "open",
        dueAt: new Date("2026-08-01T00:00:00Z"),
        deferUntil: null,
        sourceRecordId: null,
        scope: "private",
        householdId: null,
        createdByUserId: OWNER,
        lastActorUserId: OWNER,
        completedAt: null,
        ...overrides,
      });
    }

    it("a status-only update leaves untouched columns intact (no default wipe)", async () => {
      const store = makeStore();
      const action = await seed(store);

      const updated = await store.updateGeneralAction({
        ownerUserId: OWNER,
        generalActionId: action.id,
        patch: {
          status: "deferred",
          deferUntil: new Date("2026-09-01T00:00:00Z"),
          lastActorUserId: OWNER,
        },
      });

      expect(updated.status).toBe("deferred");
      // The columns the patch never mentioned must survive.
      expect(updated.dueAt?.toISOString()).toBe(action.dueAt?.toISOString());
      expect(updated.notes).toBe("Model MWF");
      expect(updated.links).toEqual([{ url: "https://example.com/filter" }]);
      expect(updated.scope).toBe("private");
    });

    it("orders by surfacing time: coalesce(deferUntil, dueAt), unscheduled last", async () => {
      const store = makeStore();
      await seed(store, { title: "Later", dueAt: new Date("2026-09-01T00:00:00Z") });
      await seed(store, { title: "Unscheduled", dueAt: null });
      await seed(store, {
        title: "Deferred soon",
        status: "deferred",
        dueAt: null,
        deferUntil: new Date("2026-07-01T00:00:00Z"),
      });
      await seed(store, { title: "Due soon", dueAt: new Date("2026-08-01T00:00:00Z") });

      const listed = await store.listGeneralActionsForOwner({ ownerUserId: OWNER });

      expect(listed.map((action) => action.title)).toEqual([
        "Deferred soon",
        "Due soon",
        "Later",
        "Unscheduled",
      ]);
    });
  });
}

runStoreContract("in-memory", createInMemoryGeneralActionStore);
