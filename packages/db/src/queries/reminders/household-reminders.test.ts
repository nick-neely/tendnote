import { describe, expect, it } from "vitest";
import { createInMemoryGeneralActionLifecycleStore } from "../general-actions/in-memory-store";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemoryReminderStore } from "./in-memory-store";
import { createReminderService } from "./service";
import type { ReminderRecord } from "./types";

/**
 * Ambient reminders across a household: several members each holding their own
 * schedule for one shared Routine, and every one of those schedules staying
 * that member's own choice about their own devices (ADR 0203).
 */
const OWNER = "user-owner";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";
const TIME_ZONE = "America/Chicago";
const NOW = new Date("2026-08-01T15:00:00.000Z");

async function householdWithRoutine() {
  const actionStore = createInMemoryGeneralActionLifecycleStore();
  const lifecycle = createGeneralActionLifecycle(actionStore);
  const workspace = await seedHouseholdWithMembers(actionStore, {
    ownerUserId: OWNER,
    name: "Home",
    members: [
      [OWNER, "owner"],
      [MEMBER, "member"],
    ],
  });
  const routine = await lifecycle.createGeneralAction({
    ownerUserId: OWNER,
    title: "Put the bins out",
    ownership: "household_native",
    householdId: workspace.id,
    recurrence: { interval: 1, unit: "week" },
    dueAt: new Date("2026-08-11T00:00:00.000Z"),
  });

  const prover = createHouseholdAuthorizationProver(actionStore);
  const reminderStore = createInMemoryReminderStore();
  const service = createReminderService({
    store: reminderStore,
    // The production wiring in `queries/reminders.ts`, in miniature: load the
    // record the *subscriber* can see, then let the proof decide.
    async loadReminderRecord(values): Promise<ReminderRecord | null> {
      const action = await actionStore.getVisibleGeneralAction({
        callerUserId: values.ownerUserId,
        generalActionId: values.recordId,
      });
      if (!action) return null;
      const kind = action.recurrence ? ("routine" as const) : ("general_action" as const);
      if (kind !== values.recordKind) return null;
      return {
        id: action.id,
        kind,
        ownerUserId: action.ownerUserId,
        ownership: action.ownership,
        householdId: action.householdId,
        title: action.title,
        status: action.status,
        occursAt: action.dueAt,
        timeSemantics: "date_only",
        recurrence: action.recurrence,
        sensitivity: "normal",
        scope: action.scope,
        personId: null,
      };
    },
    async authorizeSubscription(input) {
      const proof = await prover.proveRecordAccess({
        callerUserId: input.subscriberUserId,
        operation: "progress",
        record: {
          kind: "general_action",
          id: input.record.id,
          ownerUserId: input.record.ownerUserId,
          scope: input.record.scope,
          householdId: input.record.householdId ?? null,
          ownership: input.record.ownership ?? "member_owned",
        },
      });
      return proof.authorized;
    },
  });

  const subscribe = (userId: string) =>
    service.saveReminder({
      ownerUserId: userId,
      recordKind: "routine",
      recordId: routine.id,
      clientInstallationId: `installation-${userId}`,
      timeZone: TIME_ZONE,
      schedule: { kind: "relative", leadMinutes: 60 },
      now: NOW,
    });

  const pendingIntentsFor = async (userId: string) =>
    (
      await reminderStore.listOccurrenceIntents({
        ownerUserId: userId,
        recordKind: "routine",
        recordId: routine.id,
      })
    ).filter((intent) => intent.status !== "superseded");

  return {
    actionStore,
    lifecycle,
    workspace,
    routine,
    reminderStore,
    service,
    subscribe,
    pendingIntentsFor,
  };
}

describe("a shared Routine several members are each reminded about", () => {
  it("lets each member hold their own schedule, keyed to them", async () => {
    const { reminderStore, routine, subscribe } = await householdWithRoutine();

    const ownerSchedule = await subscribe(OWNER);
    const memberSchedule = await subscribe(MEMBER);

    expect(ownerSchedule.schedule.ownerUserId).toBe(OWNER);
    expect(memberSchedule.schedule.ownerUserId).toBe(MEMBER);
    const subscribers = await reminderStore.listScheduleSubscribers({
      recordKind: "routine",
      recordId: routine.id,
    });
    expect(subscribers.map((subscriber) => subscriber.ownerUserId)).toEqual(
      expect.arrayContaining([OWNER, MEMBER]),
    );
  });

  it("refuses a subscription from someone who cannot see the record", async () => {
    const { subscribe } = await householdWithRoutine();

    await expect(subscribe(OUTSIDER)).rejects.toThrow(/eligible explicit time-bound/);
  });

  it("never enrolls a member as a side effect of anyone else's action", async () => {
    const { lifecycle, routine, subscribe, reminderStore } = await householdWithRoutine();
    await subscribe(OWNER);

    // Being named as the Responsibility Holder is the strongest pull there is,
    // and it still puts nothing on the named member's device (ADR 0215).
    await lifecycle.setResponsibilityHolder({
      actorUserId: OWNER,
      generalActionId: routine.id,
      holderUserId: MEMBER,
    });

    await expect(
      reminderStore.listSchedules({
        ownerUserId: MEMBER,
        recordKind: "routine",
        recordId: routine.id,
      }),
    ).resolves.toEqual([]);
  });

  it("invalidates every subscriber's pending intent when any member advances the occurrence", async () => {
    const { lifecycle, routine, service, subscribe, pendingIntentsFor } =
      await householdWithRoutine();
    await subscribe(OWNER);
    await subscribe(MEMBER);
    expect(await pendingIntentsFor(OWNER)).toHaveLength(1);
    expect(await pendingIntentsFor(MEMBER)).toHaveLength(1);
    const originalIntent = (await pendingIntentsFor(MEMBER))[0];

    // The other member completes it. Nobody should be reminded tonight about an
    // occurrence that is already handled.
    await lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: routine.id });
    await service.reconcileReminderRecordForSubscribers({
      recordKind: "routine",
      recordId: routine.id,
      now: NOW,
    });

    const regenerated = await pendingIntentsFor(MEMBER);
    expect(regenerated).toHaveLength(1);
    // Deterministically regenerated for the *next* occurrence, not left holding
    // the old one.
    expect(regenerated[0]?.occurrenceKey).not.toBe(originalIntent?.occurrenceKey);
    expect(regenerated[0]?.intendedAt.getTime()).toBeGreaterThan(
      originalIntent?.intendedAt.getTime() ?? 0,
    );
  });

  it("drops every subscriber's intent when the Routine is paused, and leaves nothing to fire", async () => {
    const { lifecycle, routine, service, subscribe, pendingIntentsFor } =
      await householdWithRoutine();
    await subscribe(OWNER);
    await subscribe(MEMBER);

    await lifecycle.pauseGeneralAction({ actorUserId: MEMBER, generalActionId: routine.id });
    await service.reconcileReminderRecordForSubscribers({
      recordKind: "routine",
      recordId: routine.id,
      now: NOW,
    });

    expect(await pendingIntentsFor(OWNER)).toHaveLength(0);
    expect(await pendingIntentsFor(MEMBER)).toHaveLength(0);
  });

  it("supersedes a departed member's intent and leaves the remaining member's standing", async () => {
    const { actionStore, workspace, routine, service, subscribe, pendingIntentsFor } =
      await householdWithRoutine();
    await subscribe(OWNER);
    await subscribe(MEMBER);

    await removeHouseholdMember(actionStore, { householdId: workspace.id, userId: MEMBER });
    await service.reconcileReminderRecordForSubscribers({
      recordKind: "routine",
      recordId: routine.id,
      now: NOW,
    });

    // No alert can arrive about a record they can no longer see.
    expect(await pendingIntentsFor(MEMBER)).toHaveLength(0);
    expect(await pendingIntentsFor(OWNER)).toHaveLength(1);
  });
});
