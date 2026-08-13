import { reminderRecordKindSchema } from "@tendnote/domain/reminders";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryGeneralActionLifecycleStore } from "../general-actions/in-memory-store";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { createInMemoryReminderStore } from "./in-memory-store";
import { createReminderService } from "./service";

const OWNER = "owner-1";
const ACTION = "11111111-1111-1111-1111-111111111111";
const FOLLOW_UP = "22222222-2222-2222-2222-222222222222";
const ROUTINE = "33333333-3333-3333-3333-333333333333";
const SAVED_ITEM = "44444444-4444-4444-4444-444444444444";
const reminderDeepLink = (kind: string, id: string) => `/reminders/open?kind=${kind}&id=${id}`;

// fallow-ignore-next-line code-duplication -- Reminder scenarios intentionally repeat complete record/store setup so each scheduling lifecycle assertion remains isolated and readable.
describe("Reminder product function", () => {
  it("schedules one explicit alert for an owner's open Follow-Up", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => ({
        id: FOLLOW_UP,
        kind: "follow_up" as const,
        ownerUserId: OWNER,
        title: "Check in with Morgan",
        status: "open",
        occursAt: new Date("2026-08-14T00:00:00.000Z"),
        timeSemantics: "date_only" as const,
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
        personId: "person-1",
      })),
    });

    const result = await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "follow_up",
      recordId: FOLLOW_UP,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    expect(result.schedule).toMatchObject({
      ownerUserId: OWNER,
      recordKind: "follow_up",
      recordId: FOLLOW_UP,
      intendedAt: new Date("2026-08-14T14:00:00.000Z"),
    });
    expect(result.occurrenceIntent).toMatchObject({
      occurrenceKey: `follow_up:${FOLLOW_UP}:2026-08-14`,
      freshUntil: new Date("2026-08-15T05:00:00.000Z"),
      status: "pending_installation",
    });
    await expect(
      store.listSchedules({ ownerUserId: OWNER, recordKind: "follow_up", recordId: FOLLOW_UP }),
    ).resolves.toHaveLength(1);
  });

  it("keeps one relative Routine rule and materializes one replacement intent per occurrence", async () => {
    const store = createInMemoryReminderStore();
    let occursAt = new Date("2026-08-14T00:00:00.000Z");
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => ({
        id: ROUTINE,
        kind: "routine" as const,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        occursAt,
        timeSemantics: "date_only" as const,
        recurrence: { interval: 6, unit: "month" },
        sensitivity: "normal" as const,
        scope: "private" as const,
        personId: null,
      })),
    });
    await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "routine",
      recordId: ROUTINE,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "relative", leadMinutes: 1_440 },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    occursAt = new Date("2027-02-14T00:00:00.000Z");
    const replacement = await service.reconcileReminderRecord({
      ownerUserId: OWNER,
      recordKind: "routine",
      recordId: ROUTINE,
      now: new Date("2026-08-14T16:00:00.000Z"),
    });

    expect(replacement?.schedule).toMatchObject({
      kind: "relative",
      leadMinutes: 1_440,
      occurrenceKey: `routine:${ROUTINE}:2027-02-14`,
    });
    await expect(
      store.listOccurrenceIntents({ ownerUserId: OWNER, recordKind: "routine", recordId: ROUTINE }),
    ).resolves.toEqual([
      expect.objectContaining({ status: "superseded" }),
      expect.objectContaining({
        occurrenceKey: `routine:${ROUTINE}:2027-02-14`,
        status: "pending_installation",
      }),
    ]);
  });

  it("supersedes the skipped Routine occurrence and materializes only its next occurrence", async () => {
    const routineId = "33333333-3333-4333-8333-333333333333";
    const actionLifecycle = createGeneralActionLifecycle(
      createInMemoryGeneralActionLifecycleStore(),
    );
    const routine = await actionLifecycle.createGeneralAction({
      id: routineId,
      ownerUserId: OWNER,
      title: "Water the plants",
      dueAt: new Date("2026-08-14T00:00:00.000Z"),
      recurrence: { interval: 1, unit: "week" },
    });
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      async loadReminderRecord() {
        const current = await actionLifecycle.getGeneralAction({
          actorUserId: OWNER,
          generalActionId: routine.id,
        });
        return {
          id: current.id,
          kind: "routine" as const,
          ownerUserId: current.ownerUserId,
          title: current.title,
          status: current.status,
          occursAt: current.dueAt,
          timeSemantics: "date_only" as const,
          recurrence: current.recurrence,
          sensitivity: "normal" as const,
          scope: current.scope,
          personId: null,
        };
      },
    });
    await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "routine",
      recordId: routineId,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "relative", leadMinutes: 0 },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    await actionLifecycle.skipGeneralActionOccurrence({
      actorUserId: OWNER,
      generalActionId: routineId,
    });
    await service.reconcileReminderRecord({
      ownerUserId: OWNER,
      recordKind: "routine",
      recordId: routineId,
      now: new Date("2026-07-21T15:01:00.000Z"),
    });

    const intents = await store.listOccurrenceIntents({
      ownerUserId: OWNER,
      recordKind: "routine",
      recordId: routineId,
    });
    expect(intents).toHaveLength(2);
    expect(intents[0]?.status).toBe("superseded");
    expect(intents[1]).toMatchObject({ status: "pending_installation" });
    expect(intents[1]?.occurrenceKey).not.toBe(intents[0]?.occurrenceKey);
  });

  it("invalidates and regenerates a pending intent when its captured timezone changes", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => ({
        id: FOLLOW_UP,
        kind: "follow_up" as const,
        ownerUserId: OWNER,
        title: "Check in after the clocks change",
        status: "open",
        occursAt: new Date("2026-11-02T00:00:00.000Z"),
        timeSemantics: "date_only" as const,
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
        personId: "person-1",
      })),
    });
    const first = await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "follow_up",
      recordId: FOLLOW_UP,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    const replacement = await service.reconcileReminderRecord({
      ownerUserId: OWNER,
      recordKind: "follow_up",
      recordId: FOLLOW_UP,
      timeZone: "America/Denver",
      now: new Date("2026-07-21T16:00:00.000Z"),
    });

    expect(replacement?.schedule).toMatchObject({
      id: first.schedule.id,
      timeZone: "America/Denver",
      intendedAt: new Date("2026-11-02T16:00:00.000Z"),
    });
    expect(replacement?.occurrenceIntent?.id).not.toBe(first.occurrenceIntent?.id);
  });

  it("moves an exact Action reminder each time Set Aside changes its surfacing date", async () => {
    const store = createInMemoryReminderStore();
    const record = {
      id: ACTION,
      kind: "general_action" as const,
      ownerUserId: OWNER,
      title: "Replace the filter",
      status: "open",
      occursAt: new Date("2026-08-14T00:00:00.000Z"),
      timeSemantics: "date_only" as const,
      recurrence: null,
      sensitivity: "normal" as const,
      scope: "private" as const,
      personId: null,
    };
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => record),
    });
    const original = await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "general_action",
      recordId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "15:30" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    record.status = "deferred";
    record.occursAt = new Date("2026-08-21T00:00:00.000Z");
    const firstDeferral = await service.reconcileReminderRecord({
      ownerUserId: OWNER,
      recordKind: "general_action",
      recordId: ACTION,
      now: new Date("2026-07-22T15:00:00.000Z"),
    });
    record.occursAt = new Date("2026-08-28T00:00:00.000Z");
    const secondDeferral = await service.reconcileReminderRecord({
      ownerUserId: OWNER,
      recordKind: "general_action",
      recordId: ACTION,
      now: new Date("2026-07-23T15:00:00.000Z"),
    });

    expect(firstDeferral?.schedule).toMatchObject({
      kind: "exact",
      localTime: "15:30",
      occurrenceKey: `general_action:${ACTION}:2026-08-21`,
      intendedAt: new Date("2026-08-21T20:30:00.000Z"),
    });
    expect(secondDeferral?.schedule).toMatchObject({
      occurrenceKey: `general_action:${ACTION}:2026-08-28`,
      intendedAt: new Date("2026-08-28T20:30:00.000Z"),
    });
    expect(secondDeferral?.occurrenceIntent).toMatchObject({ status: "pending_installation" });
    await expect(
      store.listOccurrenceIntents({
        ownerUserId: OWNER,
        recordKind: "general_action",
        recordId: ACTION,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: original.occurrenceIntent?.id, status: "superseded" }),
      expect.objectContaining({ id: firstDeferral?.occurrenceIntent?.id, status: "superseded" }),
      expect.objectContaining({
        id: secondDeferral?.occurrenceIntent?.id,
        status: "pending_installation",
      }),
    ]);
  });

  it("moves a relative Action reminder to 9:00 AM on the Set Aside date", async () => {
    const store = createInMemoryReminderStore();
    const record = {
      id: ACTION,
      kind: "general_action" as const,
      ownerUserId: OWNER,
      title: "Replace the filter",
      status: "open",
      occursAt: new Date("2026-08-14T00:00:00.000Z"),
      timeSemantics: "date_only" as const,
      recurrence: null,
      sensitivity: "normal" as const,
      scope: "private" as const,
      personId: null,
    };
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => record),
    });
    await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "general_action",
      recordId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "relative", leadMinutes: 1_440 },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    record.status = "deferred";
    record.occursAt = new Date("2026-08-21T00:00:00.000Z");
    const replacement = await service.reconcileReminderRecord({
      ownerUserId: OWNER,
      recordKind: "general_action",
      recordId: ACTION,
      now: new Date("2026-07-22T15:00:00.000Z"),
    });

    expect(replacement?.schedule).toMatchObject({
      kind: "exact",
      localTime: "09:00",
      leadMinutes: null,
      occurrenceKey: `general_action:${ACTION}:2026-08-21`,
      intendedAt: new Date("2026-08-21T14:00:00.000Z"),
    });
  });

  it("replaces a Saved Item intent when bring-back changes and suppresses it on archive", async () => {
    const store = createInMemoryReminderStore();
    let status = "active";
    let occursAt: Date | null = new Date("2026-08-14T00:00:00.000Z");
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => ({
        id: SAVED_ITEM,
        kind: "saved_item" as const,
        ownerUserId: OWNER,
        title: "Filter model number",
        status,
        occursAt,
        timeSemantics: "date_only" as const,
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
        personId: null,
      })),
    });
    const first = await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "saved_item",
      recordId: SAVED_ITEM,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    occursAt = new Date("2026-08-21T00:00:00.000Z");
    const replacement = await service.reconcileReminderRecord({
      ownerUserId: OWNER,
      recordKind: "saved_item",
      recordId: SAVED_ITEM,
      now: new Date("2026-07-22T15:00:00.000Z"),
    });
    status = "archived";
    const archived = await service.reconcileReminderRecord({
      ownerUserId: OWNER,
      recordKind: "saved_item",
      recordId: SAVED_ITEM,
      now: new Date("2026-07-23T15:00:00.000Z"),
    });

    expect(replacement?.occurrenceIntent?.id).not.toBe(first.occurrenceIntent?.id);
    expect(replacement?.occurrenceIntent?.occurrenceKey).toBe(
      `saved_item:${SAVED_ITEM}:2026-08-21`,
    );
    expect(first.occurrenceIntent?.freshUntil).toEqual(new Date("2026-08-15T05:00:00.000Z"));
    expect(replacement?.occurrenceIntent?.freshUntil).toEqual(new Date("2026-08-22T05:00:00.000Z"));
    expect(archived).toBeNull();
    await expect(
      store.listActiveOccurrenceIntentsForOwner({ ownerUserId: OWNER }),
    ).resolves.toEqual([]);
  });

  it("preserves a Saved Item's bring-back instant for relative lead times", async () => {
    const store = createInMemoryReminderStore();
    const occursAt = new Date("2026-08-14T21:00:00.000Z");
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => ({
        id: SAVED_ITEM,
        kind: "saved_item" as const,
        ownerUserId: OWNER,
        title: "Order the replacement filter",
        status: "active",
        occursAt,
        timeSemantics: "instant" as const,
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
        personId: null,
      })),
    });

    const result = await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "saved_item",
      recordId: SAVED_ITEM,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "relative", leadMinutes: 60 },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    expect(result.schedule.intendedAt).toEqual(new Date("2026-08-14T20:00:00.000Z"));
    expect(result.schedule.occurrenceKey).toBe(
      `saved_item:${SAVED_ITEM}:${occursAt.toISOString()}`,
    );
    expect(result.occurrenceIntent?.freshUntil).toEqual(new Date("2026-08-14T21:00:00.000Z"));
  });

  it("rejects exact Routine alarms and collaborator enrollment", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => ({
        id: ROUTINE,
        kind: "routine" as const,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        occursAt: new Date("2026-08-14T00:00:00.000Z"),
        timeSemantics: "date_only" as const,
        recurrence: { interval: 6, unit: "month" },
        sensitivity: "normal" as const,
        scope: "household" as const,
        personId: null,
      })),
    });
    const base = {
      recordKind: "routine" as const,
      recordId: ROUTINE,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
    };

    await expect(
      service.saveReminder({
        ...base,
        ownerUserId: OWNER,
        schedule: { kind: "exact", localTime: "09:00" },
      }),
    ).rejects.toThrow("must be relative");
    await expect(
      service.saveReminder({
        ...base,
        ownerUserId: "collaborator-1",
        schedule: { kind: "relative", leadMinutes: 1_440 },
      }),
    ).rejects.toThrow("eligible explicit time-bound record");
  });

  it("keeps inferred, lifecycle-ineligible, ambient, and Today-only families silent", async () => {
    const store = createInMemoryReminderStore();
    const record = {
      id: ACTION,
      kind: "general_action" as const,
      ownerUserId: OWNER,
      title: "Replace the filter",
      status: "suggested",
      occursAt: new Date("2026-08-14T00:00:00.000Z") as Date | null,
      timeSemantics: "date_only" as const,
      recurrence: null as unknown | null,
      sensitivity: "normal" as const,
      scope: "private" as const,
      personId: null,
    };
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => record),
    });
    const save = () =>
      service.saveReminder({
        ownerUserId: OWNER,
        recordKind: record.kind,
        recordId: ACTION,
        clientInstallationId: "browser-installation-1",
        timeZone: "America/Chicago",
        schedule: { kind: "exact", localTime: "09:00" },
        now: new Date("2026-07-21T15:00:00.000Z"),
      });

    for (const status of ["suggested", "deferred", "completed", "archived"]) {
      record.status = status;
      await expect(save()).rejects.toThrow("eligible explicit time-bound record");
    }
    record.status = "open";
    record.occursAt = null;
    await expect(save()).rejects.toThrow("eligible explicit time-bound record");

    for (const ambientKind of [
      "birthday",
      "calendar_event",
      "review_item",
      "today_candidate",
      "suggestion",
    ]) {
      expect(reminderRecordKindSchema.safeParse(ambientKind).success).toBe(false);
    }
  });

  it("saves one visible 9:00 AM schedule for a dated Action before offering installation opt-in", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });

    const result = await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    expect(result.schedule).toMatchObject({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      kind: "exact",
      localTime: "09:00",
      timeZone: "America/Chicago",
      intendedAt: new Date("2026-08-14T14:00:00.000Z"),
    });
    expect(result.occurrenceIntent).toMatchObject({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      occurrenceKey: "general_action:11111111-1111-1111-1111-111111111111:2026-08-14",
      intendedAt: new Date("2026-08-14T14:00:00.000Z"),
      status: "pending_installation",
    });
    expect(result.optIn).toEqual({
      state: "offer",
      clientInstallationId: "browser-installation-1",
    });
    await expect(
      store.listSchedules({ ownerUserId: OWNER, recordKind: "general_action", recordId: ACTION }),
    ).resolves.toHaveLength(1);
  });

  it("does not create an immediate catch-up alert when a relative lead is already past", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-07-22T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });

    const result = await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "relative", leadMinutes: 1_440 },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    expect(result.occurrenceIntent).toBeNull();
    expect(result.nextValidChoice).toEqual({
      kind: "relative",
      leadMinutes: 0,
      intendedAt: new Date("2026-07-22T14:00:00.000Z"),
      label: "At 9:00 AM on the due date",
    });
  });

  it("bounds timezone reconciliation fan-out across an owner's schedules", async () => {
    const store = createInMemoryReminderStore();
    let activeLoads = 0;
    let maximumActiveLoads = 0;
    const service = createReminderService({
      store,
      loadReminderRecord: async ({ ownerUserId, recordKind, recordId }) => {
        activeLoads += 1;
        maximumActiveLoads = Math.max(maximumActiveLoads, activeLoads);
        await Promise.resolve();
        activeLoads -= 1;
        return {
          id: recordId,
          kind: recordKind,
          ownerUserId,
          title: "Scheduled record",
          status: "open",
          occursAt: new Date("2026-08-14T00:00:00.000Z"),
          timeSemantics: "date_only",
          recurrence: null,
          sensitivity: "normal",
          scope: "private",
          personId: null,
        };
      },
    });
    for (let index = 0; index < 5; index += 1) {
      await service.saveReminder({
        ownerUserId: OWNER,
        recordKind: "general_action",
        recordId: `00000000-0000-4000-8000-00000000000${index}`,
        clientInstallationId: "browser-installation-1",
        timeZone: "America/Chicago",
        schedule: { kind: "exact", localTime: "09:00" },
        now: new Date("2026-07-21T15:00:00.000Z"),
      });
    }
    activeLoads = 0;
    maximumActiveLoads = 0;

    const first = await service.reconcileReminderTimeZone({
      ownerUserId: OWNER,
      timeZone: "America/Denver",
      now: new Date("2026-07-22T15:00:00.000Z"),
      batchSize: 2,
    });
    const second = await service.reconcileReminderTimeZone({
      ownerUserId: OWNER,
      timeZone: "America/Denver",
      now: new Date("2026-07-22T15:00:00.000Z"),
      batchSize: 2,
      offset: first.nextOffset,
    });
    const third = await service.reconcileReminderTimeZone({
      ownerUserId: OWNER,
      timeZone: "America/Denver",
      now: new Date("2026-07-22T15:00:00.000Z"),
      batchSize: 2,
      offset: second.nextOffset,
    });

    expect([first.reconciled, second.reconciled, third.reconciled]).toEqual([2, 2, 1]);
    expect(third.remaining).toBe(0);
    expect(maximumActiveLoads).toBeLessThanOrEqual(2);
  });

  it("replaces an occurrence intent deterministically when the due day or timezone changes", async () => {
    const store = createInMemoryReminderStore();
    let dueAt = new Date("2026-08-14T00:00:00.000Z");
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt,
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    const base = {
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      schedule: { kind: "exact" as const, localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    };

    const first = await service.saveGeneralActionReminder({
      ...base,
      timeZone: "America/Chicago",
    });
    dueAt = new Date("2026-08-15T00:00:00.000Z");
    const replacement = await service.saveGeneralActionReminder({
      ...base,
      timeZone: "America/Denver",
    });
    const retry = await service.saveGeneralActionReminder({
      ...base,
      timeZone: "America/Denver",
    });

    expect(replacement.schedule.id).toBe(first.schedule.id);
    expect(replacement.occurrenceIntent?.id).not.toBe(first.occurrenceIntent?.id);
    expect(replacement.occurrenceIntent).toMatchObject({
      occurrenceKey: `general_action:${ACTION}:2026-08-15`,
      intendedAt: new Date("2026-08-15T15:00:00.000Z"),
      status: "pending_installation",
    });
    expect(retry.occurrenceIntent?.id).toBe(replacement.occurrenceIntent?.id);
    await expect(
      store.listOccurrenceIntents({
        ownerUserId: OWNER,
        recordKind: "general_action",
        recordId: ACTION,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: first.occurrenceIntent?.id, status: "superseded" }),
      expect.objectContaining({
        id: replacement.occurrenceIntent?.id,
        status: "pending_installation",
      }),
    ]);
  });

  it("replaces a pending installation job when its schedule changes for the same occurrence", async () => {
    const store = createInMemoryReminderStore();
    const scheduleDelivery = vi.fn(async () => undefined);
    const service = createReminderService({
      store,
      scheduleDelivery,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    const common = {
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
    };
    await service.saveGeneralActionReminder({
      ...common,
      schedule: { kind: "exact", localTime: "09:00" },
    });
    await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: common.clientInstallationId,
      subscription: {
        endpoint: "https://push.example.test/endpoint",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });

    await service.saveGeneralActionReminder({
      ...common,
      schedule: { kind: "exact", localTime: "10:30" },
      now: new Date("2026-07-21T15:02:00.000Z"),
    });

    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        intendedAt: new Date("2026-08-14T15:30:00.000Z"),
        nextAttemptAt: new Date("2026-08-14T15:30:00.000Z"),
        status: "pending",
      }),
    ]);
    expect(scheduleDelivery).toHaveBeenLastCalledWith(
      expect.objectContaining({ nextAttemptAt: new Date("2026-08-14T15:30:00.000Z") }),
    );
  });

  it("supersedes a prior future intent when an edited relative lead is already past", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-07-22T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    const common = {
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      now: new Date("2026-07-21T15:00:00.000Z"),
    };
    await service.saveGeneralActionReminder({
      ...common,
      schedule: { kind: "exact", localTime: "09:00" },
    });
    await service.saveGeneralActionReminder({
      ...common,
      schedule: { kind: "relative", leadMinutes: 1_440 },
    });

    await expect(
      store.listActiveOccurrenceIntentsForOwner({ ownerUserId: OWNER }),
    ).resolves.toEqual([]);
  });

  it("registers consent only with a subscription and creates one minimized occurrence-installation job", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    const registration = {
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      label: "Windows browser",
      subscription: {
        endpoint: "https://push.example.test/secret-endpoint",
        expirationTime: null,
        keys: { p256dh: "secret-p256dh", auth: "secret-auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    };

    const first = await service.registerReminderInstallation(registration);
    const retry = await service.registerReminderInstallation({
      ...registration,
      subscription: {
        ...registration.subscription,
        endpoint: "https://push.example.test/rotated-secret-endpoint",
        keys: { p256dh: "rotated-secret-p256dh", auth: "rotated-secret-auth" },
      },
      now: new Date("2026-07-21T15:02:00.000Z"),
    });

    expect(first.installation).toMatchObject({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      label: "Windows browser",
      status: "enabled",
      previewMode: "generic",
    });
    expect(retry.installation.id).toBe(first.installation.id);
    expect(retry.installation.endpoint).toBe("https://push.example.test/rotated-secret-endpoint");
    expect(retry.deliveryJobs[0]?.id).toBe(first.deliveryJobs[0]?.id);
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        generalActionId: ACTION,
        installationId: first.installation.id,
        status: "pending",
        attempts: 0,
      }),
    ]);
    const audit = await store.listAuditEntries({ ownerUserId: OWNER });
    expect(audit.map((entry) => entry.action)).toEqual([
      "reminder.installation_registered",
      "reminder.delivery_intent_created",
      "reminder.installation_registered",
    ]);
    expect(JSON.stringify(audit)).not.toMatch(
      /secret-endpoint|secret-p256dh|secret-auth|refrigerator water filter/i,
    );
    const settings = await service.listReminderInstallations({ ownerUserId: OWNER });
    expect(settings).toEqual([
      {
        id: first.installation.id,
        clientInstallationId: "browser-installation-1",
        label: "Windows browser",
        status: "enabled",
        previewMode: "generic",
        updatedAt: new Date("2026-07-21T15:02:00.000Z"),
      },
    ]);
    expect(JSON.stringify(settings)).not.toMatch(/endpoint|p256dh|secret-auth/i);
  });

  it("reloads authoritative state and records provider acceptance once with a generic deep link", async () => {
    const store = createInMemoryReminderStore();
    const loadGeneralAction = vi.fn(async () => ({
      id: ACTION,
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      status: "open",
      dueAt: new Date("2026-08-14T00:00:00.000Z"),
      recurrence: null,
      sensitivity: "normal" as const,
      scope: "private" as const,
    }));
    const service = createReminderService({ store, loadGeneralAction });
    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    const registration = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      subscription: {
        endpoint: "https://push.example.test/secret-endpoint",
        expirationTime: null,
        keys: { p256dh: "secret-p256dh", auth: "secret-auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    const jobId = registration.deliveryJobs[0]?.id ?? "missing";
    const sender = vi.fn(async () => ({ status: "accepted" as const, providerId: "push-1" }));

    const accepted = await service.dispatchReminder({
      deepLink: reminderDeepLink,
      jobId,
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender,
    });
    const duplicate = await service.dispatchReminder({
      deepLink: reminderDeepLink,
      jobId,
      now: new Date("2026-08-14T14:00:06.000Z"),
      sender,
    });

    expect(loadGeneralAction).toHaveBeenLastCalledWith({
      ownerUserId: OWNER,
      generalActionId: ACTION,
    });
    expect(sender).toHaveBeenCalledOnce();
    expect(sender).toHaveBeenCalledWith({
      subscription: {
        endpoint: "https://push.example.test/secret-endpoint",
        expirationTime: null,
        keys: { p256dh: "secret-p256dh", auth: "secret-auth" },
      },
      payload: {
        title: "Tendnote reminder",
        body: "Open Tendnote to see what needs your attention.",
        tag: `reminder-${jobId}`,
        data: {
          url: `/reminders/open?kind=general_action&id=${ACTION}`,
          recordKind: "general_action",
          recordId: ACTION,
        },
      },
      ttlSeconds: 53_995,
    });
    expect(accepted).toMatchObject({ status: "accepted", displayed: false });
    expect(duplicate).toEqual({ status: "already_processed" });
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        id: jobId,
        status: "completed",
        outcome: "accepted",
        attempts: 1,
      }),
    ]);
  });

  it("suppresses a pending alert when the Action is completed before dispatch", async () => {
    const store = createInMemoryReminderStore();
    let status = "open";
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status,
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    const registration = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      subscription: {
        endpoint: "https://push.example.test/endpoint",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    status = "completed";
    const sender = vi.fn(async () => ({ status: "accepted" as const }));

    await expect(
      service.dispatchReminder({
        deepLink: reminderDeepLink,
        jobId: registration.deliveryJobs[0]?.id ?? "missing",
        now: new Date("2026-08-14T14:00:05.000Z"),
        sender,
      }),
    ).resolves.toEqual({ status: "suppressed", reason: "suppressed_ineligible" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("reloads installation consent and suppresses a denied opt-in before dispatch", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    const registration = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      subscription: {
        endpoint: "https://push.example.test/endpoint",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    await service.setReminderOptInDecision({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      decision: "denied",
      now: new Date("2026-07-21T15:02:00.000Z"),
    });
    const sender = vi.fn(async () => ({ status: "accepted" as const }));

    await expect(
      service.dispatchReminder({
        deepLink: reminderDeepLink,
        jobId: registration.deliveryJobs[0]?.id ?? "missing",
        now: new Date("2026-08-14T14:00:05.000Z"),
        sender,
      }),
    ).resolves.toEqual({ status: "suppressed", reason: "suppressed_revoked" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("isolates a transient provider failure and retries only inside the original freshness window", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    const registration = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      subscription: {
        endpoint: "https://push.example.test/secret-endpoint",
        expirationTime: null,
        keys: { p256dh: "secret-p256dh", auth: "secret-auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    const jobId = registration.deliveryJobs[0]?.id ?? "missing";
    const sender = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 endpoint secret-endpoint unavailable"))
      .mockResolvedValueOnce({ status: "accepted" as const });

    const failed = await service.dispatchReminder({
      deepLink: reminderDeepLink,
      jobId,
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender,
    });
    const retried = await service.dispatchReminder({
      deepLink: reminderDeepLink,
      jobId,
      now: new Date("2026-08-14T14:05:05.000Z"),
      sender,
    });

    expect(failed).toEqual({
      status: "retry_scheduled",
      retryAt: new Date("2026-08-14T14:05:05.000Z"),
    });
    expect(retried).toMatchObject({ status: "accepted", displayed: false });
    expect(sender).toHaveBeenCalledTimes(2);
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        id: jobId,
        status: "completed",
        outcome: "accepted",
        attempts: 2,
        lastErrorCode: null,
      }),
    ]);
    expect(JSON.stringify(await store.listAuditEntries({ ownerUserId: OWNER }))).not.toContain(
      "secret-endpoint",
    );
  });

  it("revokes only the terminal installation and never retries its occurrence job", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadGeneralAction: vi.fn(async () => ({
        id: ACTION,
        ownerUserId: OWNER,
        title: "Replace the refrigerator water filter",
        status: "open",
        dueAt: new Date("2026-08-14T00:00:00.000Z"),
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
      })),
    });
    await service.saveGeneralActionReminder({
      ownerUserId: OWNER,
      generalActionId: ACTION,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });
    const registration = await service.registerReminderInstallation({
      ownerUserId: OWNER,
      clientInstallationId: "browser-installation-1",
      subscription: {
        endpoint: "https://push.example.test/gone",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      now: new Date("2026-07-21T15:01:00.000Z"),
    });
    const installation = registration.installation;
    const jobId = registration.deliveryJobs[0]?.id ?? "missing";
    const sender = vi.fn(async () => ({ status: "terminal" as const }));

    const result = await service.dispatchReminder({
      deepLink: reminderDeepLink,
      jobId,
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender,
    });
    const duplicate = await service.dispatchReminder({
      deepLink: reminderDeepLink,
      jobId,
      now: new Date("2026-08-14T14:00:06.000Z"),
      sender,
    });

    expect(result).toEqual({ status: "terminal" });
    expect(duplicate).toEqual({ status: "already_processed" });
    await expect(
      store.getInstallation({ ownerUserId: OWNER, installationId: installation.id }),
    ).resolves.toMatchObject({ status: "revoked", endpoint: null, p256dh: null, auth: null });
    await expect(
      store.getOptInState({
        ownerUserId: OWNER,
        clientInstallationId: "browser-installation-1",
      }),
    ).resolves.toMatchObject({ state: "disabled" });
    await expect(store.listDeliveryJobs({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        id: jobId,
        status: "skipped",
        outcome: "terminal_endpoint",
        attempts: 1,
      }),
    ]);
    await expect(store.listAuditEntries({ ownerUserId: OWNER })).resolves.toContainEqual(
      expect.objectContaining({
        action: "reminder.delivery_failed",
        entityId: jobId,
        metadata: expect.objectContaining({
          installationId: installation.id,
          outcome: "terminal_endpoint",
        }),
      }),
    );
  });
});
