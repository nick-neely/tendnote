import { describe, expect, it, vi } from "vitest";
import { createInMemoryReminderStore } from "./in-memory-store";
import { createReminderService } from "./service";

const OWNER = "owner-1";
const ACTION = "11111111-1111-1111-1111-111111111111";

function generalActionRecord() {
  return {
    id: ACTION,
    kind: "general_action" as const,
    ownerUserId: OWNER,
    title: "Replace the refrigerator water filter",
    status: "open",
    occursAt: new Date("2026-08-14T00:00:00.000Z"),
    timeSemantics: "date_only" as const,
    recurrence: null,
    sensitivity: "normal" as const,
    scope: "private" as const,
    personId: null,
  };
}

describe("agent-authored reminders", () => {
  it("persists a schedule without inventing a push installation", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => generalActionRecord()),
    });

    const result = await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "general_action",
      recordId: ACTION,
      timeZone: "America/Chicago",
      schedule: { kind: "exact", localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    });

    expect(result.occurrenceIntent).not.toBeNull();
    expect(result.optIn).toEqual({ state: "none", clientInstallationId: null });
    await expect(
      store.listSchedules({ ownerUserId: OWNER, recordKind: "general_action", recordId: ACTION }),
    ).resolves.toHaveLength(1);
    await expect(
      store.getOptInState({ ownerUserId: OWNER, clientInstallationId: "agent" }),
    ).resolves.toBeNull();
  });

  it("keeps structured saves on their existing wall-time policy", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => ({
        ...generalActionRecord(),
        occursAt: new Date("2026-03-08T00:00:00.000Z"),
      })),
    });

    const result = await service.saveReminder({
      ownerUserId: OWNER,
      recordKind: "general_action",
      recordId: ACTION,
      timeZone: "America/New_York",
      schedule: { kind: "exact", localTime: "02:30" },
      now: new Date("2026-03-07T15:00:00.000Z"),
    });

    // Strict wall-time clarification is scoped to Eve's #423 preflight. The
    // structured capture/editor path keeps its existing normalization contract.
    expect(result.schedule.intendedAt).toEqual(new Date("2026-03-08T07:30:00.000Z"));
  });
});
