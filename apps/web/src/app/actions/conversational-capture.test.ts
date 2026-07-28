import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolveOrCreateAndLinkPersonToSourceRecord,
  captureExplicitOutcome,
  changeExplicitCaptureOutcome,
  getGeneralAction,
  revalidatePath,
  reconcileAffectedScopes,
  updateTag,
  saveReminder,
  scheduleExplicitCaptureReminders,
  undoExplicitCaptureOutcome,
} = vi.hoisted(() => ({
  resolveOrCreateAndLinkPersonToSourceRecord: vi.fn(),
  captureExplicitOutcome: vi.fn(),
  changeExplicitCaptureOutcome: vi.fn(),
  getGeneralAction: vi.fn(),
  revalidatePath: vi.fn(),
  reconcileAffectedScopes: vi.fn(),
  updateTag: vi.fn(),
  saveReminder: vi.fn(),
  scheduleExplicitCaptureReminders: vi.fn(),
  undoExplicitCaptureOutcome: vi.fn(),
}));

vi.mock("@tendnote/db/queries/conversational-capture", () => ({
  captureExplicitOutcome,
  changeExplicitCaptureOutcome,
  undoExplicitCaptureOutcome,
}));
vi.mock("@tendnote/db/queries/source-records", () => ({
  resolveOrCreateAndLinkPersonToSourceRecord,
}));
vi.mock("@tendnote/db/queries/general-actions", () => ({ getGeneralAction }));
vi.mock("@tendnote/db/queries/reminders", () => ({
  saveReminder,
  scheduleExplicitCaptureReminders,
}));
vi.mock("next/cache", () => ({ revalidatePath, updateTag }));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwnerForAction: vi.fn().mockResolvedValue("owner-1"),
}));
vi.mock("@/lib/cache/reconcile-affected-scopes", () => ({ reconcileAffectedScopes }));

import {
  addCapturePersonAction,
  captureExplicitOutcomeAction,
  changeExplicitCaptureOutcomeAction,
  changeExplicitCaptureReminderAction,
  undoExplicitCaptureOutcomeAction,
} from "./conversational-capture";

const SAVED_ITEM_ID = "11111111-1111-4111-8111-111111111111";
const confirmation = {
  destination: "Saved Items" as const,
  groundedBySourceRecordId: "source-1",
  interpreted: { kind: "Note" as const, visibility: "Only me" as const },
  change: { kind: "edit_saved_item" as const, savedItemId: SAVED_ITEM_ID },
  undo: { kind: "archive_saved_item" as const, savedItemId: SAVED_ITEM_ID },
};

beforeEach(() => {
  vi.clearAllMocks();
  captureExplicitOutcome.mockResolvedValue({ confirmation });
  changeExplicitCaptureOutcome.mockResolvedValue({ id: SAVED_ITEM_ID });
  undoExplicitCaptureOutcome.mockResolvedValue({ id: SAVED_ITEM_ID, status: "archived" });
  resolveOrCreateAndLinkPersonToSourceRecord.mockResolvedValue({
    person: { id: "person-1", displayName: "Maya" },
    created: true,
  });
  saveReminder.mockResolvedValue({
    schedule: {
      kind: "exact",
      localTime: "09:00",
      leadMinutes: null,
      timeZone: "America/Chicago",
    },
  });
  getGeneralAction.mockResolvedValue({ recurrence: null });
  scheduleExplicitCaptureReminders.mockImplementation(async ({ result }) => result.confirmation);
});

describe("conversational Capture web adapters", () => {
  it("adds an unknown Person through the owner-scoped mutation before clarification continues", async () => {
    await expect(
      addCapturePersonAction({ displayName: "Maya", sourceRecordId: "source-1" }),
    ).resolves.toMatchObject({
      displayName: "Maya",
      personId: "person-1",
      revision: "created:person-1",
    });
    expect(updateTag).toHaveBeenCalledWith("people:owner:owner-1");
    expect(updateTag).toHaveBeenCalledWith("people:owner:owner-1:list");
    expect(updateTag).toHaveBeenCalledWith("people:owner:owner-1:person:person-1");
    expect(resolveOrCreateAndLinkPersonToSourceRecord).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      sourceRecordId: "source-1",
      displayName: "Maya",
      role: "primary",
    });
  });

  it("derives owner and authority server-side before calling the shared operation", async () => {
    const result = await captureExplicitOutcomeAction({
      interactionId: "browser-interaction",
      inputMode: "typed",
      originalText: "Keep this note",
    });
    expect(captureExplicitOutcome).toHaveBeenCalledWith({
      authority: "explicit",
      interactionId: "browser-interaction",
      inputMode: "typed",
      originalText: "Keep this note",
      ownerUserId: "owner-1",
      surface: "global_capture",
    });
    expect(result.confirmation).toEqual(confirmation);
  });

  it("passes explicit reminder Capture through the owner-scoped product scheduler", async () => {
    const actionId = "22222222-2222-4222-8222-222222222222";
    const actionConfirmation = {
      destination: "Actions" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: {
        title: "Replace the filter",
        dueAt: "2026-08-14T14:00:00.000Z",
        cadence: null,
        scope: "Only me",
      },
      change: { kind: "edit_general_action" as const, generalActionId: actionId },
      undo: { kind: "archive_general_action" as const, generalActionId: actionId },
    };
    captureExplicitOutcome.mockResolvedValue({
      confirmation: actionConfirmation,
      generalAction: { id: actionId, status: "open", recurrence: null },
    });

    const result = await captureExplicitOutcomeAction({
      interactionId: "reminder-capture",
      inputMode: "typed",
      originalText: "Remind me to replace the filter on August 14",
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
    });

    expect(scheduleExplicitCaptureReminders).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        originalText: "Remind me to replace the filter on August 14",
        result: expect.objectContaining({
          generalAction: expect.objectContaining({ id: actionId }),
        }),
      }),
    );
    expect(result.confirmation?.destination).toBe("Actions");
  });

  it("treats Remember to as explicit reminder intent", async () => {
    const actionId = "22222222-2222-4222-8222-222222222222";
    captureExplicitOutcome.mockResolvedValue({
      confirmation: {
        destination: "Actions",
        groundedBySourceRecordId: "source-1",
        interpreted: {
          title: "Replace the filter",
          dueAt: "2026-08-14T14:00:00.000Z",
          cadence: null,
          scope: "Only me",
        },
        change: { kind: "edit_general_action", generalActionId: actionId },
        undo: { kind: "archive_general_action", generalActionId: actionId },
      },
      generalAction: { id: actionId, status: "open", recurrence: null },
    });

    await captureExplicitOutcomeAction({
      interactionId: "remember-capture",
      inputMode: "typed",
      originalText: "Remember to replace the filter on August 14",
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
    });

    expect(scheduleExplicitCaptureReminders).toHaveBeenCalledOnce();
  });

  it("schedules every eligible outcome in an explicit grouped Capture", async () => {
    const actionId = "22222222-2222-4222-8222-222222222222";
    const followupId = "33333333-3333-4333-8333-333333333333";
    const actionConfirmation = {
      destination: "Actions" as const,
      groundedBySourceRecordId: "source-group",
      interpreted: {
        title: "Replace the filter",
        dueAt: "2026-08-14T14:00:00.000Z",
        cadence: null,
        scope: "Only me",
      },
      change: { kind: "edit_general_action" as const, generalActionId: actionId },
      undo: { kind: "archive_general_action" as const, generalActionId: actionId },
    };
    const followupConfirmation = {
      destination: "Follow-Ups" as const,
      groundedBySourceRecordId: "source-group",
      interpreted: {
        person: "Maya",
        dueAt: "2026-08-15T14:00:00.000Z",
        scope: "Only me",
      },
      change: { kind: "edit_followup" as const, followupId },
      undo: { kind: "archive_followup" as const, followupId },
    };
    captureExplicitOutcome.mockResolvedValue({
      confirmation: {
        destination: "Grouped",
        groundedBySourceRecordId: "source-group",
        outcomes: [actionConfirmation, followupConfirmation],
      },
      outcomes: [
        {
          kind: "general_action",
          id: actionId,
          generalAction: { id: actionId, status: "open", recurrence: null },
          confirmation: actionConfirmation,
        },
        {
          kind: "followup",
          id: followupId,
          followup: { id: followupId, status: "open" },
          confirmation: followupConfirmation,
        },
      ],
    });

    const result = await captureExplicitOutcomeAction({
      interactionId: "grouped-reminder-capture",
      inputMode: "typed",
      originalText: "Remind me to replace the filter and follow up with Maya",
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
    });

    expect(scheduleExplicitCaptureReminders).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ outcomes: expect.arrayContaining([expect.any(Object)]) }),
      }),
    );
    if (result.confirmation?.destination !== "Grouped")
      throw new Error("Expected grouped confirmation.");
    expect(result.confirmation.outcomes).toHaveLength(2);
  });

  it("changes a captured record's concrete reminder schedule through the owner-scoped adapter", async () => {
    const actionId = "22222222-2222-4222-8222-222222222222";
    saveReminder.mockResolvedValueOnce({
      schedule: {
        kind: "relative",
        localTime: null,
        leadMinutes: 1_440,
        timeZone: "America/Chicago",
      },
    });

    const result = await changeExplicitCaptureReminderAction({
      target: { kind: "edit_general_action", generalActionId: actionId },
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "relative", leadMinutes: 1_440 },
    });

    expect(saveReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        recordKind: "general_action",
        recordId: actionId,
        schedule: { kind: "relative", leadMinutes: 1_440 },
      }),
    );
    expect(result.reminderSchedule).toContain("one day before");
  });

  it("keeps corrections and Undo owner-scoped through Saved Item lifecycle operations", async () => {
    await changeExplicitCaptureOutcomeAction({
      target: { kind: "edit_saved_item", savedItemId: SAVED_ITEM_ID },
      originalText: "Corrected note",
    });
    expect(changeExplicitCaptureOutcome).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      target: { kind: "edit_saved_item", savedItemId: SAVED_ITEM_ID },
      originalText: "Corrected note",
    });

    await undoExplicitCaptureOutcomeAction({
      target: { kind: "archive_saved_item", savedItemId: SAVED_ITEM_ID },
    });
    expect(undoExplicitCaptureOutcome).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      target: { kind: "archive_saved_item", savedItemId: SAVED_ITEM_ID },
    });
  });

  it("returns a replacement confirmation when Change reroutes the grounded capture", async () => {
    const actionConfirmation = {
      destination: "Actions" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: {
        title: "Replace the filter",
        dueAt: null,
        cadence: null,
        scope: "Only me" as const,
      },
      change: {
        kind: "edit_general_action" as const,
        generalActionId: "22222222-2222-4222-8222-222222222222",
      },
      undo: {
        kind: "archive_general_action" as const,
        generalActionId: "22222222-2222-4222-8222-222222222222",
      },
    };
    changeExplicitCaptureOutcome.mockResolvedValue({ confirmation: actionConfirmation });

    const result = await changeExplicitCaptureOutcomeAction({
      target: { kind: "edit_saved_item", savedItemId: SAVED_ITEM_ID },
      originalText: "I need to replace the filter",
    });

    expect(result).toEqual({ confirmation: actionConfirmation });
  });
});
