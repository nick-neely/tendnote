import { reminderTimeSemanticsForRecordKind } from "@tendnote/domain/reminders";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryReminderStore } from "../reminders/in-memory-store";
import { createReminderService } from "../reminders/service";
import { createGeneralActionWithReminderOperation } from "./create-with-reminder";
import { createInMemoryGeneralActionLifecycleStore } from "./in-memory-store";
import { createAffectedGeneralActionLifecycle } from "./mutation-lifecycle";
import type { GeneralActionWithContext } from "./types";

const OWNER = "owner-1";
const ACTION = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-15T17:00:00.000Z");

function action() {
  return { id: ACTION, ownerUserId: OWNER } as GeneralActionWithContext;
}

function savedReminder() {
  return {
    schedule: {
      id: "schedule-1",
      ownerUserId: OWNER,
      recordKind: "general_action" as const,
      recordId: ACTION,
      generalActionId: ACTION,
      kind: "exact" as const,
      localTime: "15:00",
      leadMinutes: null,
      timeZone: "America/Chicago",
      occurrenceKey: `general_action:${ACTION}:2026-08-16`,
      intendedAt: new Date("2026-08-16T20:00:00.000Z"),
      createdAt: NOW,
      updatedAt: NOW,
    },
    occurrenceIntent: { id: "intent-1" } as never,
    optIn: { state: "none" as const, clientInstallationId: null },
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: OWNER,
    title: "Replace the fridge water filter",
    dueAt: new Date("2026-08-16T00:00:00.000Z"),
    reminder: {
      schedule: { kind: "exact" as const, localTime: "15:00" },
      timeZone: "America/Chicago",
      now: NOW,
    },
    ...overrides,
  };
}

describe("shared Action-plus-reminder creation", () => {
  it("saves one explicit schedule in the supplied owner timezone", async () => {
    const createAction = vi.fn(async () => ({ result: action(), affectedScopes: [] }));
    const saveReminder = vi.fn(async () => ({
      result: savedReminder(),
      affectedScopes: [
        { kind: "owner-collection", collection: "today", ownerUserId: OWNER } as const,
      ],
    }));

    const result = await createGeneralActionWithReminderOperation(input(), {
      createAction,
      saveReminder,
    });

    expect(createAction).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: OWNER, title: "Replace the fridge water filter" }),
    );
    expect(saveReminder).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      recordKind: "general_action",
      recordId: ACTION,
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "15:00" },
      now: NOW,
    });
    expect(result.result.reminder).toMatchObject({
      status: "scheduled",
      schedule: { timeZone: "America/Chicago", localTime: "15:00" },
    });
    expect(result.affectedScopes).toHaveLength(1);
  });

  it("uses the Routine record kind when a recurring Action is created with a reminder", async () => {
    const actionStore = createInMemoryGeneralActionLifecycleStore();
    const actions = createAffectedGeneralActionLifecycle(actionStore);
    const reminderStore = createInMemoryReminderStore();
    const reminders = createReminderService({
      store: reminderStore,
      loadGeneralAction: async ({ ownerUserId, generalActionId }) => {
        const created = await actionStore.getGeneralAction({ ownerUserId, generalActionId });
        return created
          ? {
              id: created.id,
              ownerUserId: created.ownerUserId,
              title: created.title,
              status: created.status,
              dueAt: created.dueAt,
              recurrence: created.recurrence,
              sensitivity: "normal" as const,
              scope: created.scope,
            }
          : null;
      },
    });

    const result = await createGeneralActionWithReminderOperation(
      input({
        dueAt: new Date("2026-08-17T00:00:00.000Z"),
        recurrence: { interval: 1, unit: "week" },
        reminder: {
          schedule: { kind: "relative" as const, leadMinutes: 60 },
          timeZone: "UTC",
          now: NOW,
        },
      }),
      {
        createAction: (values) => actions.createGeneralAction(values),
        saveReminder: (values) =>
          reminders.saveReminder(values).then((saved) => ({
            result: saved,
            affectedScopes: [],
          })),
      },
    );

    expect(result.result.reminder).toMatchObject({ status: "scheduled" });
    expect(result.result.reminder).not.toBeNull();
    if (result.result.reminder?.status !== "scheduled") {
      throw new Error("Expected the Routine reminder to be scheduled.");
    }
    expect(result.result.reminder.schedule.recordKind).toBe("routine");
    expect(result.result.reminder.occurrenceIntent.recordKind).toBe("routine");
    expect(result.result.reminder.schedule.intendedAt).toEqual(
      new Date("2026-08-17T08:00:00.000Z"),
    );
    expect(reminderTimeSemanticsForRecordKind("routine")).toBe("date_only");
    await expect(
      reminderStore.listSchedules({
        ownerUserId: OWNER,
        recordKind: "routine",
        recordId: result.result.action.id,
      }),
    ).resolves.toHaveLength(1);
  });

  it("keeps a successful Action when scheduling fails", async () => {
    const createAction = vi.fn(async () => ({ result: action(), affectedScopes: [] }));
    const saveReminder = vi.fn(async () => {
      throw new Error("outbox unavailable");
    });

    const result = await createGeneralActionWithReminderOperation(input(), {
      createAction,
      saveReminder,
    });

    expect(result.result.action.id).toBe(ACTION);
    expect(result.result.reminder).toEqual({ status: "failed", reason: "unavailable" });
    expect(result.affectedScopes).toEqual([]);
  });

  it("rejects an ambiguous or impossible schedule before creating the Action", async () => {
    const createAction = vi.fn(async () => ({ result: action(), affectedScopes: [] }));
    const saveReminder = vi.fn(async () => ({ result: savedReminder(), affectedScopes: [] }));

    await expect(
      createGeneralActionWithReminderOperation(input({ dueAt: null }), {
        createAction,
        saveReminder,
      }),
    ).rejects.toThrow(/concrete Action due date/i);
    expect(createAction).not.toHaveBeenCalled();
    expect(saveReminder).not.toHaveBeenCalled();

    await expect(
      createGeneralActionWithReminderOperation(
        input({
          dueAt: new Date("2026-08-15T00:00:00.000Z"),
          reminder: { ...input().reminder, schedule: { kind: "exact", localTime: "09:00" } },
        }),
        { createAction, saveReminder },
      ),
    ).rejects.toThrow(/past|future/i);

    await expect(
      createGeneralActionWithReminderOperation(
        input({
          dueAt: new Date("2026-03-08T00:00:00.000Z"),
          reminder: {
            ...input().reminder,
            timeZone: "America/New_York",
            schedule: { kind: "exact", localTime: "02:30" },
          },
        }),
        { createAction, saveReminder },
      ),
    ).rejects.toThrow(/skipped|different|concrete/i);

    await expect(
      createGeneralActionWithReminderOperation(
        input({
          dueAt: new Date("2026-11-01T00:00:00.000Z"),
          reminder: {
            ...input().reminder,
            timeZone: "America/New_York",
            schedule: { kind: "exact", localTime: "01:30" },
          },
        }),
        { createAction, saveReminder },
      ),
    ).rejects.toThrow(/different concrete time|ambiguous/i);
    expect(createAction).not.toHaveBeenCalled();
  });

  it("leaves Action-only creation unscheduled", async () => {
    const createAction = vi.fn(async () => ({ result: action(), affectedScopes: [] }));
    const saveReminder = vi.fn(async () => ({ result: savedReminder(), affectedScopes: [] }));

    const result = await createGeneralActionWithReminderOperation(input({ reminder: undefined }), {
      createAction,
      saveReminder,
    });

    expect(result.result.reminder).toBeNull();
    expect(saveReminder).not.toHaveBeenCalled();
  });
});
