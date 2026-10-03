import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy } from "@/test/action-adapter-mocks";

const { setTelemetryOptedOut } = vi.hoisted(() => ({
  setTelemetryOptedOut: vi.fn(
    async (input: { userId: string; optedOut: boolean }) => input.optedOut,
  ),
}));
vi.mock("@tendnote/db/queries/account-telemetry", () => ({ setTelemetryOptedOut }));

import { setTelemetryOptOutAction } from "./telemetry";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
});

describe("setTelemetryOptOutAction", () => {
  it("switches the signed-in owner's telemetry off and reports what was stored", async () => {
    await expect(setTelemetryOptOutAction({ optedOut: true })).resolves.toEqual({
      ok: true,
      view: { optedOut: true },
    });
    expect(setTelemetryOptedOut).toHaveBeenCalledWith({ userId: "owner-1", optedOut: true });
  });

  it("writes only for the session's owner, never a supplied one", async () => {
    await setTelemetryOptOutAction({ userId: "someone-else", optedOut: false } as unknown as {
      optedOut: boolean;
    });

    expect(setTelemetryOptedOut).toHaveBeenCalledWith({ userId: "owner-1", optedOut: false });
  });

  it("refuses a value that is not a boolean, writing nothing", async () => {
    await expect(
      setTelemetryOptOutAction({ optedOut: "yes" as unknown as boolean }),
    ).resolves.toMatchObject({ ok: false });
    expect(setTelemetryOptedOut).not.toHaveBeenCalled();
  });

  it("does not write when the admitted owner gate rejects the caller", async () => {
    requireAdmittedOwnerForActionSpy.mockRejectedValue(new Error("not admitted"));

    await expect(setTelemetryOptOutAction({ optedOut: true })).rejects.toThrow("not admitted");
    expect(setTelemetryOptedOut).not.toHaveBeenCalled();
  });
});
