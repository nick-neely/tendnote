import { describe, expect, it } from "vitest";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemorySavedItemLifecycleStore } from "./in-memory-store";
import { createSavedItemLifecycle } from "./lifecycle";

const OWNER = "owner-1";

describe("create Saved Item", () => {
  it("persists immutable source evidence first and defaults the item to private", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createSavedItemLifecycle(store);

    const item = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Filter measurements",
      content: "The refrigerator filter is 8 inches long.",
      originalText: "Fridge filter is about eight inches long",
    });

    expect(item).toMatchObject({
      ownerUserId: OWNER,
      kind: "note",
      status: "active",
      scope: "private",
      householdId: null,
      sharedWithUserIds: [],
    });
    await expect(
      store.getSourceRecord({ ownerUserId: OWNER, sourceRecordId: item.sourceRecordId }),
    ).resolves.toMatchObject({
      content: "Fridge filter is about eight inches long",
      scope: "private",
      status: "active",
    });
    await expect(
      lifecycle.getSavedItem({ callerUserId: "other-owner", savedItemId: item.id }),
    ).resolves.toBeNull();
  });
});

describe("Saved Item visibility", () => {
  it("widens visibility only for an explicitly selected active household audience", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createSavedItemLifecycle(store);
    const household = await seedHouseholdWithMembers(store, {
      ownerUserId: OWNER,
      members: [
        [OWNER, "owner"],
        ["selected-member", "member"],
        ["other-member", "member"],
      ],
    });

    const item = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "open_question",
      title: "Where should we buy the filter?",
      originalText: "Where should we buy the filter?",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: ["selected-member"],
    });

    expect(item.sharedWithUserIds).toEqual(["selected-member"]);
    await expect(
      lifecycle.getSavedItem({ callerUserId: "selected-member", savedItemId: item.id }),
    ).resolves.toMatchObject({ id: item.id });
    await expect(
      lifecycle.getSavedItem({ callerUserId: "other-member", savedItemId: item.id }),
    ).resolves.toBeNull();
  });
});

describe("edit Saved Item", () => {
  it("edits the durable item without rewriting its Source Record", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createSavedItemLifecycle(store);
    const item = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Filter measurements",
      content: "Eight inches",
      originalText: "Fridge filter is about eight inches long",
    });

    const edited = await lifecycle.editSavedItem({
      actorUserId: OWNER,
      savedItemId: item.id,
      edit: {
        title: "Refrigerator filter measurements",
        content: "Eight inches long",
        bringBackAt: new Date("2026-08-01T14:00:00Z"),
      },
    });

    expect(edited.title).toBe("Refrigerator filter measurements");
    expect(edited.bringBackAt?.toISOString()).toBe("2026-08-01T14:00:00.000Z");
    await expect(
      store.getSourceRecord({ ownerUserId: OWNER, sourceRecordId: item.sourceRecordId }),
    ).resolves.toMatchObject({ content: "Fridge filter is about eight inches long" });
    await expect(
      store.listSavedItemEvents({ ownerUserId: OWNER, savedItemId: item.id }),
    ).resolves.toMatchObject([{ kind: "created" }, { kind: "edited" }]);
  });
});

describe("Saved Item lifecycle", () => {
  it("archives and reopens notes, and resolves open questions with a reason", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createSavedItemLifecycle(store);
    const note = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Filter measurements",
      originalText: "Filter measurements",
    });
    const question = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "open_question",
      title: "Where should I buy it?",
      originalText: "Where should I buy it?",
    });

    expect(
      (await lifecycle.archiveSavedItem({ actorUserId: OWNER, savedItemId: note.id })).status,
    ).toBe("archived");
    expect(
      (await lifecycle.reopenSavedItem({ actorUserId: OWNER, savedItemId: note.id })).status,
    ).toBe("active");

    const resolved = await lifecycle.resolveSavedItem({
      actorUserId: OWNER,
      savedItemId: question.id,
      reason: "The local hardware store carries it.",
    });
    expect(resolved).toMatchObject({
      status: "archived",
      resolutionReason: "The local hardware store carries it.",
    });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    await expect(
      lifecycle.reopenSavedItem({ actorUserId: OWNER, savedItemId: question.id }),
    ).rejects.toThrow(/resolved/i);
  });
});

describe("Saved Item retrieval", () => {
  it("searches active visible items by default and includes archive only when requested", async () => {
    const scheduled: string[] = [];
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createSavedItemLifecycle(store, {
      scheduleEmbedding: async ({ recordId }) => scheduled.push(recordId),
    });
    const active = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Filter measurements",
      originalText: "Filter measurements",
    });
    const archived = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "link",
      title: "Filter shop",
      url: "https://example.com/filter",
      originalText: "Filter shop https://example.com/filter",
    });
    await lifecycle.archiveSavedItem({ actorUserId: OWNER, savedItemId: archived.id });
    await lifecycle.createSavedItem({
      ownerUserId: "other-owner",
      kind: "note",
      title: "Private filter note",
      originalText: "Private filter note",
    });

    await expect(
      lifecycle.searchSavedItems({ callerUserId: OWNER, query: "filter" }),
    ).resolves.toMatchObject([{ id: active.id }]);
    await expect(
      lifecycle.searchSavedItems({ callerUserId: OWNER, query: "filter", includeArchived: true }),
    ).resolves.toHaveLength(2);
    expect(scheduled).toEqual(expect.arrayContaining([active.id, archived.id]));
  });

  it("keeps the durable write successful when best-effort semantic scheduling fails", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createSavedItemLifecycle(store, {
      scheduleEmbedding: async () => {
        throw new Error("embedding queue unavailable");
      },
    });

    await expect(
      lifecycle.createSavedItem({
        ownerUserId: OWNER,
        kind: "note",
        title: "Filter measurements",
        originalText: "Filter measurements",
      }),
    ).resolves.toMatchObject({ status: "active", title: "Filter measurements" });
  });
});

describe("Saved Item promotion", () => {
  it("explicitly promotes once with shared evidence while inferred promotion stays review-gated", async () => {
    const created: Array<{ title: string; sourceRecordId: string }> = [];
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createSavedItemLifecycle(store, {
      createGeneralAction: async (input) => {
        created.push({ title: input.title, sourceRecordId: input.sourceRecordId });
        return { id: "action-1" };
      },
    });
    const item = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "open_question",
      title: "Where should I buy the filter?",
      originalText: "Where should I buy the filter?",
    });

    await expect(
      lifecycle.promoteSavedItemToGeneralAction({
        actorUserId: OWNER,
        savedItemId: item.id,
        authority: "inferred",
        idempotencyKey: "promotion-1",
      }),
    ).rejects.toThrow(/review/i);
    await expect(
      store.listSavedItemEvents({ ownerUserId: OWNER, savedItemId: item.id }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "mutation_rejected" })]),
    );

    const promoted = await lifecycle.promoteSavedItemToGeneralAction({
      actorUserId: OWNER,
      savedItemId: item.id,
      authority: "explicit",
      idempotencyKey: "promotion-1",
      title: "Find a refrigerator filter seller",
    });
    const retried = await lifecycle.promoteSavedItemToGeneralAction({
      actorUserId: OWNER,
      savedItemId: item.id,
      authority: "explicit",
      idempotencyKey: "promotion-1",
      title: "Find a refrigerator filter seller",
    });

    expect(created).toEqual([
      { title: "Find a refrigerator filter seller", sourceRecordId: item.sourceRecordId },
    ]);
    expect(promoted).toMatchObject({
      status: "archived",
      outcomes: [{ destinationKind: "general_action", destinationRecordId: "action-1" }],
    });
    expect(retried.outcomes).toEqual(promoted.outcomes);
  });

  it("resumes safely across failures before and after the idempotency outcome is linked", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const originalCreateOutcome = store.createSavedItemOutcome;
    const originalUpdate = store.updateSavedItem;
    const actions = new Map<string, { id: string }>();
    let failOutcomeOnce = true;
    store.createSavedItemOutcome = async (input) => {
      if (failOutcomeOnce) {
        failOutcomeOnce = false;
        throw new Error("outcome write failed");
      }
      return originalCreateOutcome(input);
    };
    const lifecycle = createSavedItemLifecycle(store, {
      createGeneralAction: async (input) => {
        const existing = actions.get(input.id);
        if (existing) return existing;
        const created = { id: input.id };
        actions.set(input.id, created);
        return created;
      },
    });
    const item = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Filter note",
      originalText: "Filter note",
    });
    const promote = () =>
      lifecycle.promoteSavedItemToGeneralAction({
        actorUserId: OWNER,
        savedItemId: item.id,
        authority: "explicit",
        idempotencyKey: "promotion-retry",
      });

    await expect(promote()).rejects.toThrow("outcome write failed");
    const afterOutcomeRetry = await promote();
    expect(actions.size).toBe(1);
    expect(afterOutcomeRetry.status).toBe("archived");

    await store.updateSavedItem({
      ownerUserId: OWNER,
      savedItemId: item.id,
      patch: { status: "active", resolvedAt: null, resolutionReason: null },
    });
    let failUpdateOnce = true;
    store.updateSavedItem = async (input) => {
      if (failUpdateOnce) {
        failUpdateOnce = false;
        throw new Error("archive write failed");
      }
      return originalUpdate(input);
    };
    await expect(promote()).rejects.toThrow("archive write failed");
    await expect(promote()).resolves.toMatchObject({ status: "archived" });
    expect(actions.size).toBe(1);
  });

  it("repairs a missing promotion audit event after the item was already archived", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const originalCreateEvent = store.createSavedItemEvent;
    let failPromotedEventOnce = true;
    store.createSavedItemEvent = async (input) => {
      if (input.kind === "promoted" && failPromotedEventOnce) {
        failPromotedEventOnce = false;
        throw new Error("promotion audit failed");
      }
      return originalCreateEvent(input);
    };
    const lifecycle = createSavedItemLifecycle(store, {
      createGeneralAction: async (input) => ({ id: input.id }),
    });
    const item = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Filter note",
      originalText: "Filter note",
    });
    const promote = () =>
      lifecycle.promoteSavedItemToGeneralAction({
        actorUserId: OWNER,
        savedItemId: item.id,
        authority: "explicit",
        idempotencyKey: "promotion-audit-retry",
      });

    await expect(promote()).rejects.toThrow("promotion audit failed");
    await expect(promote()).resolves.toMatchObject({ status: "archived" });
    const events = await store.listSavedItemEvents({
      ownerUserId: OWNER,
      savedItemId: item.id,
    });
    expect(events.filter((event) => event.kind === "promoted")).toHaveLength(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "promoted",
          detailJson: expect.objectContaining({ idempotencyKey: "promotion-audit-retry" }),
        }),
      ]),
    );
  });
});

describe("Source deletion impact", () => {
  it("reports shared evidence and linked outcomes without deleting through archive", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createSavedItemLifecycle(store, {
      createGeneralAction: async () => ({ id: "action-1" }),
    });
    const item = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Filter note",
      originalText: "Filter note",
    });
    await lifecycle.promoteSavedItemToGeneralAction({
      actorUserId: OWNER,
      savedItemId: item.id,
      authority: "explicit",
      idempotencyKey: "promotion-1",
    });

    await expect(
      lifecycle.getSourceDeletionImpact({
        actorUserId: OWNER,
        sourceRecordId: item.sourceRecordId,
      }),
    ).resolves.toMatchObject({
      sourceRecordId: item.sourceRecordId,
      linkedSavedItemIds: [item.id],
      linkedOutcomes: [{ destinationKind: "general_action", destinationRecordId: "action-1" }],
      requiresImpactDisclosure: true,
    });
    await expect(
      lifecycle.getSourceDeletionImpact({
        actorUserId: "other-owner",
        sourceRecordId: item.sourceRecordId,
      }),
    ).rejects.toThrow(/Source record not found/);
  });

  it("deletes uniquely owned evidence and its Saved Item through the separate privacy action", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createSavedItemLifecycle(store);
    const item = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Temporary private note",
      originalText: "Temporary private note",
    });

    await expect(
      lifecycle.deleteUniqueSavedItemSource({ actorUserId: OWNER, savedItemId: item.id }),
    ).resolves.toEqual({
      deletedSavedItemId: item.id,
      deletedSourceRecordId: item.sourceRecordId,
    });
    await expect(
      lifecycle.getSavedItem({ callerUserId: OWNER, savedItemId: item.id }),
    ).resolves.toBeNull();
    await expect(
      store.getSourceRecord({ ownerUserId: OWNER, sourceRecordId: item.sourceRecordId }),
    ).resolves.toBeNull();
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "saved_item.source_evidence_deleted",
          entityType: "saved_item_source",
          entityId: item.id,
        }),
      ]),
    );
  });

  it("discloses cross-domain grounding and rejects destructive deletion", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createSavedItemLifecycle(store);
    const item = await lifecycle.createSavedItem({
      ownerUserId: OWNER,
      kind: "note",
      title: "Shared grounding",
      originalText: "Shared grounding",
    });
    store.listSourceRecordDependencies = async () => [
      { recordKind: "memory", recordId: "memory-1" },
      { recordKind: "followup", recordId: "followup-1" },
    ];

    await expect(
      lifecycle.getSourceDeletionImpact({
        actorUserId: OWNER,
        sourceRecordId: item.sourceRecordId,
      }),
    ).resolves.toMatchObject({
      linkedRecords: [
        { recordKind: "memory", recordId: "memory-1" },
        { recordKind: "followup", recordId: "followup-1" },
      ],
      requiresImpactDisclosure: true,
    });
    await expect(
      lifecycle.deleteUniqueSavedItemSource({ actorUserId: OWNER, savedItemId: item.id }),
    ).rejects.toThrow(/shared or reused/i);
    await expect(
      store.listSavedItemEvents({ ownerUserId: OWNER, savedItemId: item.id }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "mutation_rejected" })]),
    );
  });
});
