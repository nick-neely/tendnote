import { beforeEach, describe, expect, it, vi } from "vitest";

const { clearReminder, requireAdmittedOwnerForAction, saveReminder } = vi.hoisted(() => ({
  clearReminder: vi.fn(),
  requireAdmittedOwnerForAction: vi.fn(),
  saveReminder: vi.fn(),
}));

vi.mock("@tendnote/db/queries/reminders", () => ({
  clearReminder,
  listReminderSchedulesForOwner: vi.fn(),
  reconcileReminderRecord: vi.fn(),
  registerReminderInstallation: vi.fn(),
  saveReminder,
  setReminderOptInDecision: vi.fn(),
}));
vi.mock("@/lib/access/current-access", () => ({ requireAdmittedOwnerForAction }));

import { clearReminderAction, saveReminderAction } from "./reminders";

const RECORD_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForAction.mockResolvedValue("owner-1");
  clearReminder.mockResolvedValue(undefined);
  saveReminder.mockResolvedValue({
    optIn: { state: "none", clientInstallationId: "browser-installation-1" },
    nextValidChoice: null,
    schedule: {
      kind: "relative",
      localTime: null,
      leadMinutes: 0,
      timeZone: "America/Chicago",
      intendedAt: new Date("2026-08-14T14:00:00.000Z"),
    },
  });
});

describe("generic Reminder server adapters", () => {
  it.each([
    "general_action",
    "follow_up",
    "routine",
    "saved_item",
  ] as const)("derives the authenticated owner and saves a %s schedule", async (recordKind) => {
    await saveReminderAction({
      recordKind,
      recordId: RECORD_ID,
      clientInstallationId: "browser-installation-1",
      timeZone: "America/Chicago",
      schedule: { kind: "relative", leadMinutes: 0 },
    });

    expect(saveReminder).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1", recordKind, recordId: RECORD_ID }),
    );
  });

  it.each([
    "general_action",
    "follow_up",
    "routine",
    "saved_item",
  ] as const)("owner-scopes clearing a %s schedule", async (recordKind) => {
    await clearReminderAction({ recordKind, recordId: RECORD_ID });

    expect(clearReminder).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1", recordKind, recordId: RECORD_ID }),
    );
  });

  it("rejects unsupported Reminder record families before persistence", async () => {
    await expect(
      saveReminderAction({
        recordKind: "birthday" as "routine",
        recordId: RECORD_ID,
        clientInstallationId: "browser-installation-1",
        timeZone: "America/Chicago",
        schedule: { kind: "relative", leadMinutes: 0 },
      }),
    ).rejects.toThrow();
    expect(saveReminder).not.toHaveBeenCalled();
  });
});
