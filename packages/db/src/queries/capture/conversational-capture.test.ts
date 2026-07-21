import { describe, expect, it } from "vitest";
import { createInMemorySavedItemLifecycleStore } from "../saved-items";
import { createConversationalCapture } from "./conversational-capture";

describe("conversational Capture", () => {
  it("persists private source evidence before confirming a fallback Saved Item", async () => {
    const baseStore = createInMemorySavedItemLifecycleStore();
    const writes: string[] = [];
    const store = {
      ...baseStore,
      async createSourceRecord(input: Parameters<typeof baseStore.createSourceRecord>[0]) {
        writes.push("source");
        return baseStore.createSourceRecord(input);
      },
      async createSavedItem(input: Parameters<typeof baseStore.createSavedItem>[0]) {
        writes.push("saved_item");
        return baseStore.createSavedItem(input);
      },
    };
    const capture = createConversationalCapture(store);

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "mobile-capture-1",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Where should I buy the refrigerator water filter?",
      surface: "global_capture",
    });

    expect(writes).toEqual(["source", "saved_item"]);
    expect(result.sourceRecord).toMatchObject({
      content: "Where should I buy the refrigerator water filter?",
      ownerUserId: "owner-1",
      scope: "private",
      metadataJson: expect.objectContaining({
        audioRetained: false,
        captureSurface: "global_capture",
        inputMode: "typed",
      }),
    });
    expect(result.savedItem).toMatchObject({
      kind: "open_question",
      ownerUserId: "owner-1",
      scope: "private",
      sourceRecordId: result.sourceRecord.id,
    });
    expect(result.confirmation).toMatchObject({
      destination: "Saved Items",
      groundedBySourceRecordId: result.sourceRecord.id,
      interpreted: { kind: "Open question", visibility: "Only me" },
      undo: { kind: "archive_saved_item", savedItemId: result.savedItem.id },
    });
    expect(await baseStore.listAuditLogEntries({ ownerUserId: "owner-1" })).toEqual([
      expect.objectContaining({
        action: "capture.explicit_saved_item_source_created",
        entityId: result.sourceRecord.id,
      }),
    ]);
  });

  it("returns the existing grounded outcome for an exact retry from one interaction", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const capture = createConversationalCapture(store);
    const input = {
      authority: "explicit" as const,
      interactionId: "mobile-capture-retry",
      inputMode: "typed" as const,
      ownerUserId: "owner-1",
      originalText: "Save the filter buying guide",
      surface: "global_capture" as const,
    };

    const first = await capture.capture(input);
    const retry = await capture.capture(input);

    expect(retry.sourceRecord.id).toBe(first.sourceRecord.id);
    expect(retry.savedItem.id).toBe(first.savedItem.id);
    expect(await store.listVisibleSavedItems({ callerUserId: "owner-1" })).toHaveLength(1);
    expect(
      await store.listSavedItemEvents({
        ownerUserId: "owner-1",
        savedItemId: first.savedItem.id,
      }),
    ).toHaveLength(1);
  });

  it("collapses concurrent rapid retries to one auditable outcome", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const capture = createConversationalCapture(store);
    const input = {
      authority: "explicit" as const,
      interactionId: "rapid-retry",
      inputMode: "typed" as const,
      ownerUserId: "owner-1",
      originalText: "Save this once",
      surface: "global_capture" as const,
    };

    const [first, second] = await Promise.all([capture.capture(input), capture.capture(input)]);
    expect(second.savedItem.id).toBe(first.savedItem.id);
    expect(await store.listVisibleSavedItems({ callerUserId: "owner-1" })).toHaveLength(1);
    expect(
      await store.listSavedItemEvents({
        ownerUserId: "owner-1",
        savedItemId: first.savedItem.id,
      }),
    ).toHaveLength(1);
    expect(await store.listAuditLogEntries({ ownerUserId: "owner-1" })).toHaveLength(1);
  });

  it("refuses a concurrent retry that reuses the interaction for different wording", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const capture = createConversationalCapture(store);
    const base = {
      authority: "explicit" as const,
      interactionId: "racing-retry",
      inputMode: "typed" as const,
      ownerUserId: "owner-1",
      surface: "global_capture" as const,
    };

    const outcomes = await Promise.allSettled([
      capture.capture({ ...base, originalText: "First wording" }),
      capture.capture({ ...base, originalText: "Different wording?" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(await store.listVisibleSavedItems({ callerUserId: "owner-1" })).toHaveLength(1);
  });

  it("refuses inferred or empty writes at the shared operation boundary", async () => {
    const capture = createConversationalCapture(createInMemorySavedItemLifecycleStore());
    await expect(
      capture.capture({
        authority: "inferred" as "explicit",
        interactionId: "turn-1",
        inputMode: "typed",
        ownerUserId: "owner-1",
        originalText: "This was only inferred",
        surface: "eve",
      }),
    ).rejects.toThrow();
    await expect(
      capture.capture({
        authority: "explicit",
        interactionId: "turn-2",
        inputMode: "typed",
        ownerUserId: "owner-1",
        originalText: "   ",
        surface: "eve",
      }),
    ).rejects.toThrow();
  });

  it("records dictated transcripts without retaining audio", async () => {
    const capture = createConversationalCapture(createInMemorySavedItemLifecycleStore());
    const result = await capture.capture({
      authority: "explicit",
      interactionId: "dictation-turn",
      inputMode: "dictated",
      ownerUserId: "owner-1",
      originalText: "Keep the filter model number",
      surface: "eve",
    });
    expect(result.sourceRecord.metadataJson).toMatchObject({
      audioRetained: false,
      captureSurface: "eve",
      inputMode: "dictated",
    });
  });

  it("rejects changed input on the same interaction but keeps later captures distinct", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const capture = createConversationalCapture(store);
    const base = {
      authority: "explicit" as const,
      inputMode: "typed" as const,
      ownerUserId: "owner-1",
      originalText: "Keep the filter model number",
      surface: "global_capture" as const,
    };
    const first = await capture.capture({ ...base, interactionId: "turn-a" });
    await expect(
      capture.capture({ ...base, interactionId: "turn-a", originalText: "Different text" }),
    ).rejects.toThrow("already used for different input");
    const later = await capture.capture({ ...base, interactionId: "turn-b" });
    expect(later.savedItem.id).not.toBe(first.savedItem.id);
    expect(await store.listVisibleSavedItems({ callerUserId: "owner-1" })).toHaveLength(2);
  });

  it("scopes stable retry identities to the owner", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const capture = createConversationalCapture(store);
    const input = {
      authority: "explicit" as const,
      interactionId: "shared-client-key",
      inputMode: "typed" as const,
      originalText: "Private note",
      surface: "global_capture" as const,
    };
    const first = await capture.capture({ ...input, ownerUserId: "owner-1" });
    const second = await capture.capture({ ...input, ownerUserId: "owner-2" });
    expect(second.savedItem.id).not.toBe(first.savedItem.id);
    expect(await store.listVisibleSavedItems({ callerUserId: "owner-1" })).toHaveLength(1);
    expect(await store.listVisibleSavedItems({ callerUserId: "owner-2" })).toHaveLength(1);
  });

  it("preserves source evidence when item persistence fails and completes on retry", async () => {
    const baseStore = createInMemorySavedItemLifecycleStore();
    let fail = true;
    const store = {
      ...baseStore,
      async createSavedItem(input: Parameters<typeof baseStore.createSavedItem>[0]) {
        if (fail) {
          fail = false;
          throw new Error("saved item unavailable");
        }
        return baseStore.createSavedItem(input);
      },
    };
    const capture = createConversationalCapture(store);
    const input = {
      authority: "explicit" as const,
      interactionId: "recoverable-turn",
      inputMode: "typed" as const,
      ownerUserId: "owner-1",
      originalText: "Keep my draft safe",
      surface: "global_capture" as const,
    };

    await expect(capture.capture(input)).rejects.toThrow("saved item unavailable");
    expect(await baseStore.listAuditLogEntries({ ownerUserId: "owner-1" })).toHaveLength(1);
    const recovered = await capture.capture(input);
    expect(recovered.sourceRecord.content).toBe("Keep my draft safe");
    expect(await baseStore.listAuditLogEntries({ ownerUserId: "owner-1" })).toHaveLength(1);
  });

  it("corrects and safely undoes the Saved Item without rewriting source evidence", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const capture = createConversationalCapture(store);
    const created = await capture.capture({
      authority: "explicit",
      interactionId: "correction-turn",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Original wording",
      surface: "global_capture",
    });

    const changed = await capture.change({
      actorUserId: "owner-1",
      savedItemId: created.savedItem.id,
      originalText: "Corrected wording",
    });
    expect(changed).toMatchObject({ content: "Corrected wording", title: "Corrected wording" });
    expect(
      await store.getSourceRecord({
        ownerUserId: "owner-1",
        sourceRecordId: created.sourceRecord.id,
      }),
    ).toMatchObject({ content: "Original wording" });

    const undone = await capture.undo({
      actorUserId: "owner-1",
      savedItemId: created.savedItem.id,
    });
    expect(undone.status).toBe("archived");
    const retriedUndo = await capture.undo({
      actorUserId: "owner-1",
      savedItemId: created.savedItem.id,
    });
    expect(retriedUndo.status).toBe("archived");
    expect(
      (
        await store.listSavedItemEvents({
          ownerUserId: "owner-1",
          savedItemId: created.savedItem.id,
        })
      ).filter((event) => event.kind === "archived"),
    ).toHaveLength(1);
  });
});
