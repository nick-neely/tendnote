import { describe, expect, it, vi } from "vitest";
import { createInMemorySavedItemLifecycleStore, createSavedItemLifecycle } from "../saved-items";
import { createAffectedSavedItemLifecycle } from "../saved-items/mutation-lifecycle";
import { createConversationalCapture } from "./conversational-capture";

type CaptureResult = Awaited<ReturnType<ReturnType<typeof createConversationalCapture>["capture"]>>;

function savedItemFrom(result: CaptureResult) {
  if (!result.savedItem) throw new Error("Expected this Capture to create a Saved Item.");
  return result.savedItem;
}

const ACTION_SCOPE = {
  kind: "owner-collection" as const,
  collection: "today" as const,
  ownerUserId: "owner-1",
};

function actionMutationOutcome<T>(result: T, affectedScopes = [ACTION_SCOPE]) {
  return { result, affectedScopes };
}

function createFollowupMutationMock() {
  return vi.fn().mockImplementation(async (input) =>
    actionMutationOutcome({
      ...input,
      id: input.id,
      status: "open",
    }),
  );
}

async function expectOnePersistedSavedItem(
  store: ReturnType<typeof createInMemorySavedItemLifecycleStore>,
  result: CaptureResult,
) {
  expect(await store.listVisibleSavedItems({ callerUserId: "owner-1" })).toHaveLength(1);
  expect(
    await store.listSavedItemEvents({
      ownerUserId: "owner-1",
      savedItemId: savedItemFrom(result).id,
    }),
  ).toHaveLength(1);
}

function actionCaptureHarness() {
  const store = createInMemorySavedItemLifecycleStore();
  const createGeneralAction = vi.fn().mockImplementation(async (input) =>
    actionMutationOutcome({
      ...input,
      id: input.id,
      status: "open",
    }),
  );
  const capture = createConversationalCapture(store, {
    createGeneralAction,
    now: () => new Date("2026-07-21T04:30:00.000Z"),
    ownerTimeZone: () => "America/Chicago",
  });
  return { capture, createGeneralAction, store };
}

describe("conversational Capture", () => {
  it("routes explicit one-time work to a private source-grounded unscheduled Action", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const createGeneralAction = vi.fn().mockImplementation(async (input) =>
      actionMutationOutcome({
        ...input,
        id: input.id,
        status: "open",
      }),
    );
    const capture = createConversationalCapture(store, { createGeneralAction });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "action-1",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "I need to replace the refrigerator water filter",
      surface: "global_capture",
    });

    expect(createGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        ownerUserId: "owner-1",
        title: "Replace the refrigerator water filter",
        dueAt: null,
        recurrence: null,
        scope: "private",
        sourceRecordId: result.sourceRecord.id,
      }),
    );
    expect(result).toMatchObject({
      generalAction: { status: "open" },
      affectedScopes: [ACTION_SCOPE],
      confirmation: {
        destination: "Actions",
        groundedBySourceRecordId: result.sourceRecord.id,
        interpreted: {
          dueAt: null,
          scope: "Only me",
        },
      },
    });
    expect(await store.listVisibleSavedItems({ callerUserId: "owner-1" })).toHaveLength(0);
  });

  it("routes clear cadence and owner-timezone dates through the same Action boundary", async () => {
    const { capture, createGeneralAction } = actionCaptureHarness();

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "routine-1",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Remember to replace the filter every 6 months",
      surface: "eve",
    });

    expect(createGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({
        recurrence: { interval: 6, unit: "month" },
        sourceRecordId: result.sourceRecord.id,
      }),
    );
    expect(result.confirmation?.destination).toBe("Routines");
  });

  it("returns an existing Action on an exact retry instead of creating a duplicate", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    let persisted: { id: string; status: string } | null = null;
    const createGeneralAction = vi.fn().mockImplementation(async (input) => {
      persisted = { id: input.id, status: "open" };
      return actionMutationOutcome(persisted);
    });
    const capture = createConversationalCapture(store, {
      createGeneralAction,
      getGeneralAction: vi.fn().mockImplementation(async () => persisted),
    });
    const input = {
      authority: "explicit" as const,
      interactionId: "action-retry",
      inputMode: "typed" as const,
      ownerUserId: "owner-1",
      originalText: "I need to replace the refrigerator water filter",
      surface: "global_capture" as const,
    };

    const first = await capture.capture(input);
    const retry = await capture.capture(input);

    expect(retry.generalAction?.id).toBe(first.generalAction?.id);
    expect(createGeneralAction).toHaveBeenCalledTimes(1);
  });

  it("persists source evidence before returning one focused consequential clarification", async () => {
    const baseStore = createInMemorySavedItemLifecycleStore();
    const writes: string[] = [];
    const store = {
      ...baseStore,
      async createSourceRecord(input: Parameters<typeof baseStore.createSourceRecord>[0]) {
        writes.push("source");
        return baseStore.createSourceRecord(input);
      },
    };
    const capture = createConversationalCapture(store, {
      now: () => new Date("2026-07-21T04:30:00.000Z"),
      ownerTimeZone: () => "America/Chicago",
    });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "clarify-1",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Remind me to replace the filter sometime",
      surface: "global_capture",
    });

    expect(writes).toEqual(["source"]);
    expect(result).toMatchObject({
      sourceRecord: { status: "pending_resolution" },
      clarification: {
        field: "timing",
        question: "When should I remind you to replace the filter?",
        sourceRecordId: result.sourceRecord.id,
      },
    });
    expect(await baseStore.listVisibleSavedItems({ callerUserId: "owner-1" })).toHaveLength(0);
  });

  it("reuses the original Source Record when a timing clarification completes the flow", async () => {
    const { capture, createGeneralAction, store } = actionCaptureHarness();
    const base = {
      authority: "explicit" as const,
      interactionId: "clarify-complete",
      inputMode: "typed" as const,
      ownerUserId: "owner-1",
      originalText: "Remind me to replace the filter sometime",
      surface: "global_capture" as const,
    };

    const pending = await capture.capture(base);
    const completed = await capture.capture({ ...base, clarificationAnswer: "tomorrow" });

    expect(completed.sourceRecord.id).toBe(pending.sourceRecord.id);
    expect(completed.sourceRecord.content).toBe(base.originalText);
    expect(completed.sourceRecord.status).toBe("active");
    expect(createGeneralAction).toHaveBeenCalledWith(
      expect.objectContaining({
        dueAt: new Date("2026-07-21T14:00:00.000Z"),
        sourceRecordId: pending.sourceRecord.id,
      }),
    );
    expect(await store.listAuditLogEntries({ ownerUserId: "owner-1" })).toHaveLength(1);
  });

  it("replaces impossible timing and unsupported cadence when clarification completes", async () => {
    const { capture, createGeneralAction } = actionCaptureHarness();
    const cases = [
      {
        interactionId: "replace-invalid-date",
        originalText: "Remind me to replace the filter on February 30",
        clarificationAnswer: "on March 1",
        expected: { dueAt: new Date("2027-03-01T15:00:00.000Z"), recurrence: null },
      },
      {
        interactionId: "replace-invalid-cadence",
        originalText: "Remember to replace the filter every 0 days",
        clarificationAnswer: "weekly",
        expected: { dueAt: null, recurrence: { interval: 1, unit: "week" } },
      },
    ];

    for (const testCase of cases) {
      const input = {
        authority: "explicit" as const,
        interactionId: testCase.interactionId,
        inputMode: "typed" as const,
        ownerUserId: "owner-1",
        originalText: testCase.originalText,
        surface: "global_capture" as const,
      };
      const pending = await capture.capture(input);
      expect(pending.clarification).toBeDefined();
      const completed = await capture.capture({
        ...input,
        clarificationAnswer: testCase.clarificationAnswer,
      });
      expect(completed.confirmation).toBeDefined();
      expect(createGeneralAction).toHaveBeenLastCalledWith(
        expect.objectContaining(testCase.expected),
      );
    }
  });

  it("creates a Follow-Up only for one exact owner-scoped person and concrete timing", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const createFollowup = createFollowupMutationMock();
    const capture = createConversationalCapture(store, {
      createFollowup,
      now: () => new Date("2026-07-21T04:30:00.000Z"),
      ownerTimeZone: () => "America/Chicago",
      searchPeople: vi.fn().mockResolvedValue([{ id: "person-maya", displayName: "Maya" }]),
    });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "followup-1",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Remind me to follow up with Maya tomorrow",
      surface: "global_capture",
    });

    expect(createFollowup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        ownerUserId: "owner-1",
        personId: "person-maya",
        reason: "Follow up",
        dueAt: new Date("2026-07-21T14:00:00.000Z"),
        sourceRecordId: result.sourceRecord.id,
        scope: "private",
      }),
    );
    expect(result).toMatchObject({
      affectedScopes: [ACTION_SCOPE],
      confirmation: {
        destination: "Follow-Ups",
        interpreted: { person: "Maya", scope: "Only me" },
      },
    });
  });

  it("keeps an ambiguous person grounded and asks one focused clarification", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const createFollowup = createFollowupMutationMock();
    const capture = createConversationalCapture(store, {
      createFollowup,
      now: () => new Date("2026-07-21T04:30:00.000Z"),
      ownerTimeZone: () => "America/Chicago",
      searchPeople: vi.fn().mockImplementation(async ({ query }) =>
        query === "Maya Chen"
          ? [{ id: "maya-2", displayName: "Maya Chen" }]
          : [
              { id: "maya-1", displayName: "Maya" },
              { id: "maya-2", displayName: "Maya" },
            ],
      ),
    });
    const input = {
      authority: "explicit",
      interactionId: "ambiguous-person",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Remind me to follow up with Maya tomorrow",
      surface: "eve",
    } as const;

    const result = await capture.capture(input);

    expect(createFollowup).not.toHaveBeenCalled();
    expect(result.clarification).toEqual({
      field: "person",
      question: "Which Maya did you mean?",
      sourceRecordId: result.sourceRecord.id,
    });

    const completed = await capture.capture({
      ...input,
      clarificationAnswer: "Maya Chen",
    });
    expect(completed.sourceRecord.id).toBe(result.sourceRecord.id);
    expect(createFollowup).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: "maya-2",
        sourceRecordId: result.sourceRecord.id,
      }),
    );
    expect(completed.affectedScopes).toEqual([ACTION_SCOPE]);
  });

  it("offers explicit Add and Link actions when a Follow-Up person is unknown", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const capture = createConversationalCapture(store, {
      createFollowup: vi.fn(),
      now: () => new Date("2026-07-21T04:30:00.000Z"),
      ownerTimeZone: () => "America/Chicago",
      searchPeople: vi.fn().mockResolvedValue([]),
    });

    const result = await capture.capture({
      authority: "explicit",
      interactionId: "unknown-person",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Remind me to follow up with Maya tomorrow",
      surface: "global_capture",
    });

    expect(result.clarification).toMatchObject({
      field: "person",
      actions: [
        {
          kind: "add_person",
          label: "Add Maya",
          displayName: "Maya",
          unresolvedMentionId: expect.any(String),
        },
        { kind: "link_person", label: "Link someone else" },
      ],
    });
    expect(result.sourceRecord.status).toBe("pending_resolution");
    await expect(
      store.listUnresolvedMentions({ sourceRecordId: result.sourceRecord.id }),
    ).resolves.toMatchObject([
      { mentionText: "Maya", status: "unresolved", candidatePersonIds: [] },
    ]);
  });

  it("uses real destination lifecycle operations for Change and retry-safe Undo", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const source = await store.createSourceRecord({
      ownerUserId: "owner-1",
      sourceType: "manual",
      content: "I need to correct the action wording",
      scope: "private",
    });
    const editGeneralAction = vi.fn().mockResolvedValue(actionMutationOutcome({ id: "action-1" }));
    const archiveGeneralAction = vi
      .fn()
      .mockResolvedValue(actionMutationOutcome({ id: "action-1", status: "archived" }));
    const getGeneralAction = vi
      .fn()
      .mockResolvedValueOnce({ id: "action-1", status: "open", sourceRecordId: source.id })
      .mockResolvedValueOnce({ id: "action-1", status: "open", sourceRecordId: source.id })
      .mockResolvedValueOnce({ id: "action-1", status: "archived" });
    const capture = createConversationalCapture(store, {
      archiveGeneralAction,
      editGeneralAction,
      getGeneralAction,
    });

    const changed = await capture.changeOutcome({
      actorUserId: "owner-1",
      target: {
        kind: "edit_general_action",
        generalActionId: "11111111-1111-4111-8111-111111111111",
      },
      originalText: "I need to use corrected action wording",
    });
    await capture.undoOutcome({
      actorUserId: "owner-1",
      target: {
        kind: "archive_general_action",
        generalActionId: "11111111-1111-4111-8111-111111111111",
      },
    });
    await capture.undoOutcome({
      actorUserId: "owner-1",
      target: {
        kind: "archive_general_action",
        generalActionId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(editGeneralAction).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      generalActionId: "11111111-1111-4111-8111-111111111111",
      edit: {
        title: "Use corrected action wording",
        dueAt: null,
        recurrence: null,
      },
    });
    expect(changed).toMatchObject({
      affectedScopes: [ACTION_SCOPE],
      confirmation: {
        destination: "Actions",
        interpreted: {
          title: "Use corrected action wording",
          dueAt: null,
          cadence: null,
        },
      },
    });
    expect(archiveGeneralAction).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh active replacement and audit entry for every cross-destination reroute", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const actions = new Map<
      string,
      {
        id: string;
        status: string;
        sourceRecordId: string;
        recurrence: null;
      }
    >();
    const followups = new Map<
      string,
      { id: string; status: string; sourceRecordId: string; personId: string }
    >();
    const createGeneralAction = vi.fn().mockImplementation(async (input) => {
      const action = {
        id: input.id,
        status: "open",
        sourceRecordId: input.sourceRecordId,
        recurrence: null,
      };
      actions.set(action.id, action);
      return actionMutationOutcome(action);
    });
    const capture = createConversationalCapture(store, {
      createGeneralAction,
      getGeneralAction: vi
        .fn()
        .mockImplementation(async ({ generalActionId }) => actions.get(generalActionId) ?? null),
      archiveGeneralAction: vi.fn().mockImplementation(async ({ generalActionId }) => {
        const action = actions.get(generalActionId);
        if (!action) throw new Error("missing action");
        action.status = "archived";
        return actionMutationOutcome(action);
      }),
      createFollowup: vi.fn().mockImplementation(async (input) => {
        const followup = {
          id: input.id,
          status: "open",
          sourceRecordId: input.sourceRecordId,
          personId: input.personId,
        };
        followups.set(followup.id, followup);
        return actionMutationOutcome(followup);
      }),
      getFollowup: vi
        .fn()
        .mockImplementation(async ({ followupId }) => followups.get(followupId) ?? null),
      archiveFollowup: vi.fn().mockImplementation(async ({ followupId }) => {
        const followup = followups.get(followupId);
        if (!followup) throw new Error("missing follow-up");
        followup.status = "archived";
        return actionMutationOutcome(followup);
      }),
      searchPeople: vi.fn().mockResolvedValue([{ id: "person-maya", displayName: "Maya" }]),
      now: () => new Date("2026-07-21T04:30:00.000Z"),
      ownerTimeZone: () => "America/Chicago",
    });
    const original = await capture.capture({
      authority: "explicit",
      interactionId: "reroute-cycle",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "The filter needs replacing",
      surface: "global_capture",
    });
    if (!original.confirmation) throw new Error("Expected a Saved Item confirmation.");
    if (original.confirmation.destination === "Grouped") {
      throw new Error("Expected one Saved Item confirmation.");
    }
    const firstAction = await capture.changeOutcome({
      actorUserId: "owner-1",
      target: original.confirmation.change,
      originalText: "I need to replace the filter",
    });
    if (!("confirmation" in firstAction)) throw new Error("Expected an Action confirmation.");
    if (firstAction.confirmation.destination === "Grouped") {
      throw new Error("Expected one Action confirmation.");
    }
    const followup = await capture.changeOutcome({
      actorUserId: "owner-1",
      target: firstAction.confirmation.change,
      originalText: "Remind me to follow up with Maya tomorrow",
    });
    if (!("confirmation" in followup)) throw new Error("Expected a Follow-Up confirmation.");
    if (followup.confirmation.destination === "Grouped") {
      throw new Error("Expected one Follow-Up confirmation.");
    }
    const secondAction = await capture.changeOutcome({
      actorUserId: "owner-1",
      target: followup.confirmation.change,
      originalText: "I need to order a replacement filter",
    });
    if (!("affectedScopes" in followup) || !("affectedScopes" in secondAction)) {
      throw new Error("Expected rerouted mutation scopes.");
    }
    const firstActionRecord =
      "generalAction" in firstAction ? firstAction.generalAction : undefined;
    const secondActionRecord =
      "generalAction" in secondAction ? secondAction.generalAction : undefined;
    if (!firstActionRecord || !secondActionRecord) {
      throw new Error("Expected both Action reroutes to create Actions.");
    }

    expect(followup.affectedScopes).toEqual([ACTION_SCOPE, ACTION_SCOPE]);
    expect(secondAction.affectedScopes).toEqual([ACTION_SCOPE, ACTION_SCOPE]);
    expect(secondActionRecord).toMatchObject({ status: "open" });
    expect(secondActionRecord.id).not.toBe(firstActionRecord.id);
    expect(createGeneralAction).toHaveBeenCalledTimes(2);
    const reroutes = (await store.listAuditLogEntries({ ownerUserId: "owner-1" })).filter(
      (entry) => entry.action === "capture.reroute",
    );
    expect(reroutes).toHaveLength(3);
    expect(reroutes.map((entry) => entry.metadataJson)).toEqual([
      expect.objectContaining({ from: "Saved Items", to: "Actions" }),
      expect.objectContaining({ from: "Actions", to: "Follow-Ups" }),
      expect.objectContaining({ from: "Follow-Ups", to: "Actions" }),
    ]);
  });

  it("reroutes a corrected Saved Item into an Action while preserving evidence and audit", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const createdActions = new Map<
      string,
      { id: string; status: string; sourceRecordId: string }
    >();
    const createGeneralAction = vi.fn().mockImplementation(async (input) => {
      const action = { id: input.id, status: "open", sourceRecordId: input.sourceRecordId };
      createdActions.set(action.id, action);
      return actionMutationOutcome(action);
    });
    const capture = createConversationalCapture(store, {
      createGeneralAction,
      getGeneralAction: vi
        .fn()
        .mockImplementation(
          async ({ generalActionId }) => createdActions.get(generalActionId) ?? null,
        ),
    });
    const original = await capture.capture({
      authority: "explicit",
      interactionId: "reroute-saved-item",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "The filter needs replacing",
      surface: "global_capture",
    });
    const originalItem = savedItemFrom(original);

    const corrected = await capture.changeOutcome({
      actorUserId: "owner-1",
      target: { kind: "edit_saved_item", savedItemId: originalItem.id },
      originalText: "I need to replace the filter",
    });
    const retried = await capture.changeOutcome({
      actorUserId: "owner-1",
      target: { kind: "edit_saved_item", savedItemId: originalItem.id },
      originalText: "I need to replace the filter",
    });

    expect(corrected).toMatchObject({
      confirmation: {
        destination: "Actions",
        groundedBySourceRecordId: original.sourceRecord.id,
      },
      generalAction: { sourceRecordId: original.sourceRecord.id },
    });
    expect(retried).toMatchObject({
      generalAction: { id: expect.any(String) },
    });
    expect(createGeneralAction).toHaveBeenCalledTimes(1);
    expect(
      await store.getSavedItem({ ownerUserId: "owner-1", savedItemId: originalItem.id }),
    ).toMatchObject({ status: "archived" });
    const rerouteEntries = (await store.listAuditLogEntries({ ownerUserId: "owner-1" })).filter(
      (entry) => entry.action === "capture.reroute",
    );
    expect(rerouteEntries).toHaveLength(1);
    expect(rerouteEntries).toContainEqual(
      expect.objectContaining({
        action: "capture.reroute",
        entityId: original.sourceRecord.id,
        metadataJson: expect.objectContaining({ from: "Saved Items", to: "Actions" }),
      }),
    );
  });

  it("keeps the mistaken outcome active until a correction clarification completes", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const createdActions = new Map<
      string,
      { id: string; status: string; sourceRecordId: string }
    >();
    const capture = createConversationalCapture(store, {
      createGeneralAction: vi.fn().mockImplementation(async (input) => {
        const action = { id: input.id, status: "open", sourceRecordId: input.sourceRecordId };
        createdActions.set(action.id, action);
        return actionMutationOutcome(action);
      }),
      getGeneralAction: vi
        .fn()
        .mockImplementation(
          async ({ generalActionId }) => createdActions.get(generalActionId) ?? null,
        ),
      now: () => new Date("2026-07-21T04:30:00.000Z"),
      ownerTimeZone: () => "America/Chicago",
    });
    const original = await capture.capture({
      authority: "explicit",
      interactionId: "reroute-clarify",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "The filter needs replacing",
      surface: "global_capture",
    });
    const originalItem = savedItemFrom(original);
    const correction = {
      actorUserId: "owner-1",
      target: { kind: "edit_saved_item" as const, savedItemId: originalItem.id },
      originalText: "Remind me to replace the filter sometime",
    };

    const pending = await capture.changeOutcome(correction);
    expect(pending).toMatchObject({
      clarification: { field: "timing", sourceRecordId: original.sourceRecord.id },
    });
    expect(
      await store.getSavedItem({ ownerUserId: "owner-1", savedItemId: originalItem.id }),
    ).toMatchObject({ status: "active" });

    const completed = await capture.changeOutcome({
      ...correction,
      clarificationAnswer: "tomorrow",
    });
    expect(completed).toMatchObject({
      confirmation: {
        destination: "Actions",
        groundedBySourceRecordId: original.sourceRecord.id,
      },
    });
    expect(
      await store.getSavedItem({ ownerUserId: "owner-1", savedItemId: originalItem.id }),
    ).toMatchObject({ status: "archived" });
  });

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
      undo: { kind: "archive_saved_item", savedItemId: savedItemFrom(result).id },
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
    expect(savedItemFrom(retry).id).toBe(savedItemFrom(first).id);
    await expectOnePersistedSavedItem(store, first);
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
    expect(savedItemFrom(second).id).toBe(savedItemFrom(first).id);
    await expectOnePersistedSavedItem(store, first);
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
    expect(savedItemFrom(later).id).not.toBe(savedItemFrom(first).id);
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
    expect(savedItemFrom(second).id).not.toBe(savedItemFrom(first).id);
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

  it("preserves source evidence when Action persistence fails and completes on retry", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    let fail = true;
    const createGeneralAction = vi.fn().mockImplementation(async (input) => {
      if (fail) {
        fail = false;
        throw new Error("action unavailable");
      }
      return actionMutationOutcome({ id: input.id, status: "open" });
    });
    const capture = createConversationalCapture(store, { createGeneralAction });
    const input = {
      authority: "explicit" as const,
      interactionId: "recoverable-action",
      inputMode: "typed" as const,
      ownerUserId: "owner-1",
      originalText: "I need to replace the filter",
      surface: "global_capture" as const,
    };

    await expect(capture.capture(input)).rejects.toThrow("action unavailable");
    expect(await store.listAuditLogEntries({ ownerUserId: "owner-1" })).toHaveLength(1);
    const recovered = await capture.capture(input);
    expect(recovered.generalAction?.id).toBeDefined();
    expect(recovered.sourceRecord.content).toBe(input.originalText);
    expect(await store.listAuditLogEntries({ ownerUserId: "owner-1" })).toHaveLength(1);
  });

  it("corrects and safely undoes the Saved Item without rewriting source evidence", async () => {
    const store = createInMemorySavedItemLifecycleStore();
    const lifecycle = createAffectedSavedItemLifecycle(createSavedItemLifecycle(store));
    const editSavedItem = vi.fn(lifecycle.editSavedItem);
    const archiveSavedItem = vi.fn(lifecycle.archiveSavedItem);
    const capture = createConversationalCapture(store, { archiveSavedItem, editSavedItem });
    const created = await capture.capture({
      authority: "explicit",
      interactionId: "correction-turn",
      inputMode: "typed",
      ownerUserId: "owner-1",
      originalText: "Original wording",
      surface: "global_capture",
    });
    expect(created.affectedScopes).toEqual(
      expect.arrayContaining([
        { kind: "owner-collection", collection: "saved-items", ownerUserId: "owner-1" },
        { kind: "owner-collection", collection: "today", ownerUserId: "owner-1" },
      ]),
    );

    const changed = await capture.change({
      actorUserId: "owner-1",
      savedItemId: savedItemFrom(created).id,
      originalText: "Corrected wording",
    });
    expect(changed).toMatchObject({
      result: { content: "Corrected wording", title: "Corrected wording" },
      affectedScopes: expect.arrayContaining([
        { kind: "owner-collection", collection: "saved-items", ownerUserId: "owner-1" },
      ]),
    });
    expect(editSavedItem).toHaveBeenCalledOnce();
    expect(
      await store.getSourceRecord({
        ownerUserId: "owner-1",
        sourceRecordId: created.sourceRecord.id,
      }),
    ).toMatchObject({ content: "Original wording" });

    const undone = await capture.undoOutcome({
      actorUserId: "owner-1",
      target: { kind: "archive_saved_item", savedItemId: savedItemFrom(created).id },
    });
    expect(undone).toMatchObject({
      result: { status: "archived" },
      affectedScopes: expect.any(Array),
    });
    expect(archiveSavedItem).toHaveBeenCalledOnce();
    const retriedUndo = await capture.undoOutcome({
      actorUserId: "owner-1",
      target: { kind: "archive_saved_item", savedItemId: savedItemFrom(created).id },
    });
    expect(retriedUndo).toMatchObject({ result: { status: "archived" }, affectedScopes: [] });
    expect(
      (
        await store.listSavedItemEvents({
          ownerUserId: "owner-1",
          savedItemId: savedItemFrom(created).id,
        })
      ).filter((event) => event.kind === "archived"),
    ).toHaveLength(1);
  });
});
