import { describe, expect, it, vi } from "vitest";
import { createExplicitCaptureReminderScheduler, type saveReminder } from "../reminders";

const OWNER = "owner-1";
const ACTION = "22222222-2222-4222-8222-222222222222";
const FOLLOWUP = "33333333-3333-4333-8333-333333333333";

function actionConfirmation(actionId = ACTION) {
  return {
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
}

function followupConfirmation() {
  return {
    destination: "Follow-Ups" as const,
    groundedBySourceRecordId: "source-1",
    interpreted: {
      person: "Maya",
      dueAt: "2026-08-15T14:00:00.000Z",
      scope: "Only me",
    },
    change: { kind: "edit_followup" as const, followupId: FOLLOWUP },
    undo: { kind: "archive_followup" as const, followupId: FOLLOWUP },
  };
}

function setup(optInState: "none" | "offer" = "none") {
  const save = vi.fn(async (input: Parameters<typeof saveReminder>[0]) => ({
    result: {
      optIn: { state: optInState, clientInstallationId: input.clientInstallationId },
      nextValidChoice: null,
      occurrenceIntent: null,
      schedule: {
        id: "schedule-1",
        ownerUserId: OWNER,
        recordKind: input.recordKind,
        recordId: input.recordId,
        generalActionId: input.recordKind === "general_action" ? input.recordId : null,
        kind: input.schedule.kind,
        localTime: input.schedule.kind === "exact" ? input.schedule.localTime : null,
        leadMinutes: input.schedule.kind === "relative" ? input.schedule.leadMinutes : null,
        timeZone: input.timeZone,
        occurrenceKey: "occurrence-1",
        intendedAt: new Date("2026-08-14T14:00:00.000Z"),
        createdAt: input.now,
        updatedAt: input.now,
      },
    },
    affectedScopes: [
      { kind: "owner-collection" as const, collection: "today" as const, ownerUserId: OWNER },
    ],
  }));
  return {
    save,
    schedule: createExplicitCaptureReminderScheduler(save as typeof saveReminder),
  };
}

describe("explicit Capture Reminder product policy", () => {
  it("recognizes Remember to and schedules an eligible Action", async () => {
    const { save, schedule } = setup();
    const confirmation = actionConfirmation();

    const result = await schedule({
      ownerUserId: OWNER,
      originalText: "Remember to replace the filter on August 14",
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
      result: {
        sourceRecord: {} as never,
        confirmation,
        generalAction: { id: ACTION, status: "open", recurrence: null },
      },
    });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ recordKind: "general_action", recordId: ACTION }),
    );
    expect(result.result.confirmation).toMatchObject({
      interpreted: { reminderSchedule: expect.any(String) },
    });
    expect(result.affectedScopes).toContainEqual({
      kind: "owner-collection",
      collection: "today",
      ownerUserId: OWNER,
    });
  });

  it("preserves an earned opt-in offer for the shell presenter", async () => {
    const { schedule } = setup("offer");
    const confirmation = actionConfirmation();

    const result = await schedule({
      ownerUserId: OWNER,
      originalText: "Remember to replace the filter on August 14",
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
      result: {
        sourceRecord: {} as never,
        confirmation,
        generalAction: { id: ACTION, status: "open", recurrence: null },
      },
    });

    expect(result.result.reminderOptInOffered).toBe(true);
  });

  it("schedules every eligible outcome in a grouped explicit Capture", async () => {
    const { save, schedule } = setup();
    const action = actionConfirmation();
    const followup = followupConfirmation();

    const result = await schedule({
      ownerUserId: OWNER,
      originalText: "Remind me to replace the filter and follow up with Maya",
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
      result: {
        sourceRecord: {} as never,
        confirmation: {
          destination: "Grouped",
          groundedBySourceRecordId: "source-1",
          outcomes: [action, followup],
        },
        outcomes: [
          {
            kind: "general_action",
            id: ACTION,
            generalAction: { id: ACTION, status: "open", recurrence: null },
            confirmation: action,
          },
          {
            kind: "followup",
            id: FOLLOWUP,
            followup: { id: FOLLOWUP, status: "open" },
            confirmation: followup,
          },
        ],
      },
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(result.result.confirmation?.destination).toBe("Grouped");
  });

  it("applies an explicitly scoped lead only to the outcome that requested an alert", async () => {
    const { save, schedule } = setup();
    const action = actionConfirmation();
    const question = {
      destination: "Saved Items" as const,
      groundedBySourceRecordId: "source-1",
      interpreted: { kind: "Open question" as const, visibility: "Only me" },
      change: { kind: "edit_saved_item" as const, savedItemId: "saved-item-1" },
      undo: { kind: "archive_saved_item" as const, savedItemId: "saved-item-1" },
    };

    const result = await schedule({
      ownerUserId: OWNER,
      originalText:
        "Remind me to replace the filter on August 21 with an alert one week before; and also save an open question: Where should I buy it? Bring it back on August 14",
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
      result: {
        sourceRecord: {} as never,
        confirmation: {
          destination: "Grouped",
          groundedBySourceRecordId: "source-1",
          outcomes: [action, question],
        },
        outcomes: [
          {
            kind: "general_action",
            id: ACTION,
            generalAction: { id: ACTION, status: "open", recurrence: null },
            confirmation: action,
            reminderSchedule: { kind: "relative", leadMinutes: 10_080 },
          },
          {
            kind: "saved_item",
            id: "saved-item-1",
            savedItem: {
              id: "saved-item-1",
              kind: "open_question",
              bringBackAt: new Date("2026-08-14T14:00:00.000Z"),
              bringBackTimeSemantics: "date_only",
            } as never,
            confirmation: question,
          },
        ],
      },
    });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        recordKind: "general_action",
        recordId: ACTION,
        schedule: { kind: "relative", leadMinutes: 10_080 },
      }),
    );
    expect(result.result.confirmation).toMatchObject({
      destination: "Grouped",
      outcomes: [
        { interpreted: { reminderSchedule: expect.stringMatching(/one week before/) } },
        { destination: "Saved Items" },
      ],
    });
  });

  it("preserves an explicitly scoped lead on a single Action Capture", async () => {
    const { save, schedule } = setup();
    const confirmation = actionConfirmation();

    const result = await schedule({
      ownerUserId: OWNER,
      originalText: "Remind me to replace the filter on August 21 with an alert one week before",
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
      result: {
        sourceRecord: {} as never,
        confirmation,
        generalAction: { id: ACTION, status: "open", recurrence: null },
        reminderSchedule: { kind: "relative", leadMinutes: 10_080 },
      },
    });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        recordKind: "general_action",
        recordId: ACTION,
        schedule: { kind: "relative", leadMinutes: 10_080 },
      }),
    );
    expect(result.result.confirmation).toMatchObject({
      interpreted: { reminderSchedule: expect.stringMatching(/one week before/) },
    });
  });

  it("does not enroll non-reminder Capture wording", async () => {
    const { save, schedule } = setup();
    const confirmation = actionConfirmation();

    await schedule({
      ownerUserId: OWNER,
      originalText: "Replace the filter on August 14",
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
      result: {
        sourceRecord: {} as never,
        confirmation,
        generalAction: { id: ACTION, status: "open", recurrence: null },
      },
    });

    expect(save).not.toHaveBeenCalled();
  });
});
