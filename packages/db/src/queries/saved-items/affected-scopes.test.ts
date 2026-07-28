import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemorySavedItemLifecycleStore } from "./in-memory-store";
import { createSavedItemLifecycle } from "./lifecycle";
import { createAffectedSavedItemLifecycle } from "./mutation-lifecycle";

const OWNER = "owner-1";

describe("Saved Item affected-scope contract", () => {
  it("routes the production Saved Item lifecycle through the affected-scope seam", () => {
    // There is no live Drizzle adapter harness, so the production half of this
    // store contract is a source-wiring guard; behavior runs in memory below.
    const source = readFileSync(join(import.meta.dirname, "..", "saved-items.ts"), "utf8");
    expect(source).toContain(
      "createAffectedSavedItemLifecycle(\n  createSavedItemLifecycle(createDrizzleSavedItemLifecycleStore()",
    );
    for (const mutation of [
      "createSavedItem",
      "editSavedItem",
      "archiveSavedItem",
      "reopenSavedItem",
      "resolveSavedItem",
      "promoteSavedItemToGeneralAction",
      "deleteUniqueSavedItemSource",
    ]) {
      expect(source).toMatch(new RegExp(`export (?:async )?function ${mutation}`));
    }
  });

  it("returns scopes for every lifecycle write and preserves promoted Action audiences", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const actionScopes = [
      {
        kind: "viewer-collection" as const,
        collection: "general-actions" as const,
        viewerUserId: "member-1",
      },
      {
        kind: "owner-collection" as const,
        collection: "today" as const,
        ownerUserId: "member-1",
      },
    ];
    const lifecycle = createAffectedSavedItemLifecycle(
      createSavedItemLifecycle(store, {
        createGeneralAction: async (input) => ({
          result: { id: input.id },
          affectedScopes: actionScopes,
        }),
      }),
    );
    const created = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "open_question",
      title: "Which filter size fits?",
      originalText: "Which filter size fits?",
    });

    expect(created.affectedScopes).toEqual(
      expect.arrayContaining([
        { kind: "owner-collection", collection: "saved-items", ownerUserId: OWNER },
        { kind: "viewer-collection", collection: "saved-items", viewerUserId: OWNER },
        {
          kind: "viewer-entity",
          entity: "saved-item",
          entityId: created.result.id,
          viewerUserId: OWNER,
        },
        { kind: "visible-entity", entity: "saved-item", entityId: created.result.id },
        { kind: "owner-collection", collection: "today", ownerUserId: OWNER },
        { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
      ]),
    );

    const edited = await lifecycle.editSavedItem({
      actorUserId: OWNER,
      savedItemId: created.result.id,
      edit: { title: "Exact filter measurements" },
    });
    expect(edited.affectedScopes).toEqual(created.affectedScopes);

    const archived = await lifecycle.archiveSavedItem({
      actorUserId: OWNER,
      savedItemId: created.result.id,
    });
    expect(archived.affectedScopes).toEqual(created.affectedScopes);

    const reopened = await lifecycle.reopenSavedItem({
      actorUserId: OWNER,
      savedItemId: created.result.id,
    });
    expect(reopened.affectedScopes).toEqual(created.affectedScopes);

    const resolved = await lifecycle.resolveSavedItem({
      actorUserId: OWNER,
      savedItemId: created.result.id,
      reason: "Measurements confirmed.",
    });
    expect(resolved.affectedScopes).toEqual(created.affectedScopes);

    const promotable = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Buy the right filter",
      originalText: "Buy the right filter",
    });
    const promoted = await lifecycle.promoteSavedItemToGeneralAction({
      actorUserId: OWNER,
      savedItemId: promotable.result.id,
      authority: "explicit",
      idempotencyKey: "saved-item-contract",
    });
    expect(promoted.affectedScopes).toEqual(
      expect.arrayContaining([...promotable.affectedScopes, ...actionScopes]),
    );

    const deletable = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Temporary evidence",
      originalText: "Temporary evidence",
    });
    const deleted = await lifecycle.deleteUniqueSavedItemSource({
      actorUserId: OWNER,
      savedItemId: deletable.result.id,
    });
    expect(deleted.result.deletedSavedItemId).toBe(deletable.result.id);
    expect(deleted.affectedScopes).toEqual(deletable.affectedScopes);
  });
});
