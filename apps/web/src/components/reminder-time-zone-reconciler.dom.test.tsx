// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@/test/dom";

const reconcileReminderTimeZoneAction = vi.fn();

vi.mock("@/app/actions/reminders", () => ({
  reconcileReminderTimeZoneAction: (...args: unknown[]) => reconcileReminderTimeZoneAction(...args),
}));

import { ReminderTimeZoneReconciler } from "./reminder-time-zone-reconciler";

describe("ReminderTimeZoneReconciler", () => {
  beforeEach(() => {
    window.localStorage.clear();
    reconcileReminderTimeZoneAction.mockReset();
    reconcileReminderTimeZoneAction.mockResolvedValue({
      ok: true,
      view: { reconciled: 2, remaining: 0, nextOffset: 2 },
    });
  });

  it("regenerates schedules when the browser's current timezone changes", async () => {
    window.localStorage.setItem("tendnote.reminder-time-zone", "America/Denver");

    render(<ReminderTimeZoneReconciler />);

    await waitFor(() =>
      expect(reconcileReminderTimeZoneAction).toHaveBeenCalledWith({
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
    expect(window.localStorage.getItem("tendnote.reminder-time-zone")).toContain(
      `${Intl.DateTimeFormat().resolvedOptions().timeZone}|utc-offset-minutes:`,
    );
  });

  it("regenerates schedules after a daylight-saving offset change in the same timezone", async () => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    window.localStorage.setItem(
      "tendnote.reminder-time-zone",
      `${timeZone}|utc-offset-minutes:999`,
    );

    render(<ReminderTimeZoneReconciler />);

    await waitFor(() => expect(reconcileReminderTimeZoneAction).toHaveBeenCalledWith({ timeZone }));
  });

  it("continues bounded reconciliation batches until the owner has no schedules remaining", async () => {
    reconcileReminderTimeZoneAction
      .mockResolvedValueOnce({
        ok: true,
        view: { reconciled: 8, remaining: 2, nextOffset: 8 },
      })
      .mockResolvedValueOnce({
        ok: true,
        view: { reconciled: 2, remaining: 0, nextOffset: 10 },
      });

    render(<ReminderTimeZoneReconciler />);

    await waitFor(() => expect(reconcileReminderTimeZoneAction).toHaveBeenCalledTimes(2));
    expect(reconcileReminderTimeZoneAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offset: 8 }),
    );
  });
});
