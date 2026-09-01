import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy, revalidatePathSpy } from "@/test/action-adapter-mocks";

const {
  beginReminderInstallationOptIn,
  claimReminderStandaloneContinuation,
  clearReminder,
  disableCurrentReminderInstallation,
  disableReminderInstallation,
  getReminderInstallationState,
  markReminderStandaloneContinuation,
  reconcileReminderTimeZone,
  saveReminder,
  setReminderInstallationPreviewMode,
} = vi.hoisted(() => ({
  beginReminderInstallationOptIn: vi.fn(),
  claimReminderStandaloneContinuation: vi.fn(),
  clearReminder: vi.fn(),
  disableCurrentReminderInstallation: vi.fn(),
  disableReminderInstallation: vi.fn(),
  getReminderInstallationState: vi.fn(),
  markReminderStandaloneContinuation: vi.fn(),
  reconcileReminderTimeZone: vi.fn(),
  saveReminder: vi.fn(),
  setReminderInstallationPreviewMode: vi.fn(),
}));

vi.mock("@tendnote/db/queries/reminders", () => ({
  clearReminder,
  beginReminderInstallationOptIn,
  claimReminderStandaloneContinuation,
  disableCurrentReminderInstallation,
  disableReminderInstallation,
  getReminderInstallationState,
  markReminderStandaloneContinuation,
  reconcileReminderTimeZone,
  registerReminderInstallation: vi.fn(),
  saveReminder,
  setReminderInstallationPreviewMode,
  setReminderOptInDecision: vi.fn(),
}));

import {
  beginReminderInstallationOptInAction,
  claimReminderStandaloneContinuationAction,
  clearReminderAction,
  disableCurrentReminderInstallationAction,
  getReminderInstallationStateAction,
  markReminderStandaloneContinuationAction,
  revokeReminderInstallationAction,
  saveReminderAction,
  setReminderInstallationPreviewModeAction,
} from "./reminders";

const RECORD_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  const accountScopes = [
    { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
  ];
  clearReminder.mockResolvedValue({ result: undefined, affectedScopes: accountScopes });
  saveReminder.mockResolvedValue({
    result: {
      optIn: { state: "none", clientInstallationId: "browser-installation-1" },
      occurrenceIntent: null,
      nextValidChoice: null,
      schedule: {
        kind: "relative",
        localTime: null,
        leadMinutes: 0,
        timeZone: "America/Chicago",
        intendedAt: new Date("2026-08-14T14:00:00.000Z"),
      },
    },
    affectedScopes: accountScopes,
  });
  disableCurrentReminderInstallation.mockResolvedValue({
    result: { installation: null, suppressedJobs: [] },
    affectedScopes: accountScopes,
  });
  disableReminderInstallation.mockResolvedValue({
    result: { installation: null, suppressedJobs: [] },
    affectedScopes: accountScopes,
  });
  getReminderInstallationState.mockResolvedValue({ optIn: null, installation: null });
  beginReminderInstallationOptIn.mockResolvedValue({ result: {}, affectedScopes: accountScopes });
  markReminderStandaloneContinuation.mockResolvedValue({
    result: {},
    affectedScopes: accountScopes,
  });
  reconcileReminderTimeZone.mockResolvedValue({
    result: { outcomes: [], reconciled: 0, remaining: 0, nextOffset: 0 },
    affectedScopes: accountScopes,
  });
  claimReminderStandaloneContinuation.mockResolvedValue({
    result: null,
    affectedScopes: accountScopes,
  });
  setReminderInstallationPreviewMode.mockResolvedValue({
    result: { previewMode: "detailed" },
    affectedScopes: accountScopes,
  });
});

describe("generic Reminder server adapters", () => {
  it.each(["general_action", "follow_up", "routine", "saved_item"] as const)(
    "derives the authenticated owner and saves a %s schedule",
    async (recordKind) => {
      const result = await saveReminderAction({
        recordKind,
        recordId: RECORD_ID,
        clientInstallationId: "browser-installation-1",
        timeZone: "America/Chicago",
        schedule: { kind: "relative", leadMinutes: 0 },
      });

      expect(saveReminder).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: "owner-1", recordKind, recordId: RECORD_ID }),
      );
      expect(result).toMatchObject({ ok: true, view: { occurrenceIntentCreated: false } });
      if (recordKind === "general_action" || recordKind === "routine") {
        expect(revalidatePathSpy).toHaveBeenCalledWith("/account");
      }
      expect(revalidatePathSpy).toHaveBeenCalledWith("/account");
    },
  );

  it.each(["general_action", "follow_up", "routine", "saved_item"] as const)(
    "owner-scopes clearing a %s schedule",
    async (recordKind) => {
      await clearReminderAction({ recordKind, recordId: RECORD_ID });

      expect(clearReminder).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: "owner-1", recordKind, recordId: RECORD_ID }),
      );
    },
  );

  it("rejects unsupported Reminder record families before persistence", async () => {
    await expect(
      saveReminderAction({
        recordKind: "birthday" as "routine",
        recordId: RECORD_ID,
        clientInstallationId: "browser-installation-1",
        timeZone: "America/Chicago",
        schedule: { kind: "relative", leadMinutes: 0 },
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(saveReminder).not.toHaveBeenCalled();
  });

  it("derives the owner when disabling the current installation for sign-out", async () => {
    await disableCurrentReminderInstallationAction({
      clientInstallationId: "browser-installation-1",
      reason: "sign_out",
    });

    expect(disableCurrentReminderInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        clientInstallationId: "browser-installation-1",
        reason: "sign_out",
      }),
    );
  });

  it("owner-scopes the installation settings adapters", async () => {
    await getReminderInstallationStateAction({
      clientInstallationId: "browser-installation-1",
    });
    await beginReminderInstallationOptInAction({
      clientInstallationId: "browser-installation-1",
    });
    await markReminderStandaloneContinuationAction({
      clientInstallationId: "browser-installation-1",
    });
    await claimReminderStandaloneContinuationAction({
      clientInstallationId: "standalone-installation-1",
    });
    await setReminderInstallationPreviewModeAction({
      clientInstallationId: "browser-installation-1",
      previewMode: "detailed",
    });
    await revokeReminderInstallationAction({
      installationId: RECORD_ID,
    });

    expect(getReminderInstallationState).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      clientInstallationId: "browser-installation-1",
    });
    expect(beginReminderInstallationOptIn).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        clientInstallationId: "browser-installation-1",
      }),
    );
    expect(markReminderStandaloneContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        clientInstallationId: "browser-installation-1",
      }),
    );
    expect(claimReminderStandaloneContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        clientInstallationId: "standalone-installation-1",
      }),
    );
    expect(setReminderInstallationPreviewMode).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        clientInstallationId: "browser-installation-1",
        previewMode: "detailed",
      }),
    );
    expect(disableReminderInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        installationId: RECORD_ID,
        reason: "remote_revocation",
      }),
    );
  });
});
