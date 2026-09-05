import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy } from "@/test/action-adapter-mocks";

/**
 * The Approval Mode goes through the real query layer over the in-memory access
 * profile store, so a round trip proves the thing the account control depends on:
 * what the action wrote is what the next read answers. Only the store is
 * substituted - the enum, the patch, and the "no profile answers ask" rule are
 * the shipped ones.
 */
const { accessProfileQueries, recordEveSessionToolTrust } = vi.hoisted(() => ({
  accessProfileQueries: { current: null as unknown },
  recordEveSessionToolTrust: vi.fn(),
}));

vi.mock("@tendnote/db/queries/access-profiles", async () => {
  const actual = await vi.importActual<typeof import("@tendnote/db/queries/access-profiles")>(
    "@tendnote/db/queries/access-profiles",
  );
  const queries = actual.createAccessProfileQueries(
    actual.createInMemoryAccessProfileStore([
      {
        userId: "owner-1",
        status: "granted",
        source: "manual_grant",
        grantedAt: new Date("2026-01-01T00:00:00.000Z"),
        selfContextOnboardingStatus: "completed",
        selfContextOnboardingReminderAt: null,
        householdCheckinEnabled: false,
        eveApprovalMode: "ask",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]),
  );
  accessProfileQueries.current = queries;
  return { ...actual, setEveApprovalMode: queries.setEveApprovalMode };
});

vi.mock("@tendnote/db/queries/eve-session-tool-trusts", async () => {
  const actual = await vi.importActual<
    typeof import("@tendnote/db/queries/eve-session-tool-trusts")
  >("@tendnote/db/queries/eve-session-tool-trusts");
  return { ...actual, recordEveSessionToolTrust };
});

import { recordSessionToolTrustAction, setEveApprovalModeAction } from "./eve-approvals";

function queries() {
  return accessProfileQueries.current as {
    getEveApprovalMode: (input: { userId: string }) => Promise<"ask" | "trusted">;
    setEveApprovalMode: (input: {
      userId: string;
      mode: "ask" | "trusted";
    }) => Promise<"ask" | "trusted">;
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  recordEveSessionToolTrust.mockResolvedValue({ recorded: true });
  await queries().setEveApprovalMode({ userId: "owner-1", mode: "ask" });
});

describe("setEveApprovalModeAction", () => {
  it("stores the chosen mode for the session's owner and reads it back", async () => {
    await expect(setEveApprovalModeAction({ mode: "trusted" })).resolves.toEqual({
      ok: true,
      view: { mode: "trusted" },
    });

    await expect(queries().getEveApprovalMode({ userId: "owner-1" })).resolves.toBe("trusted");
  });

  it("takes the owner back to asking every time", async () => {
    await setEveApprovalModeAction({ mode: "trusted" });

    await expect(setEveApprovalModeAction({ mode: "ask" })).resolves.toEqual({
      ok: true,
      view: { mode: "ask" },
    });
    await expect(queries().getEveApprovalMode({ userId: "owner-1" })).resolves.toBe("ask");
  });

  /** Two values are the whole enum; anything else is not a mode the policy knows. */
  it("refuses a mode that is not one of the two, changing nothing", async () => {
    await expect(
      setEveApprovalModeAction({ mode: "always" as unknown as "ask" }),
    ).resolves.toMatchObject({ ok: false });

    await expect(queries().getEveApprovalMode({ userId: "owner-1" })).resolves.toBe("ask");
  });

  it("does not write when the admitted owner gate rejects the caller", async () => {
    requireAdmittedOwnerForActionSpy.mockRejectedValue(new Error("not admitted"));

    await expect(setEveApprovalModeAction({ mode: "trusted" })).rejects.toThrow("not admitted");
    await expect(queries().getEveApprovalMode({ userId: "owner-1" })).resolves.toBe("ask");
  });
});

describe("recordSessionToolTrustAction", () => {
  /**
   * The load-bearing one. The browser names the conversation and the tool; whose
   * conversation it is comes only from the session, and an `ownerUserId` supplied
   * alongside is not a field this action has.
   */
  it("records the trust against the session owner, never a supplied one", async () => {
    await expect(
      recordSessionToolTrustAction({
        ownerUserId: "someone-else",
        sessionId: "session-1",
        toolName: "capture_memory",
      } as unknown as { sessionId: string; toolName: string }),
    ).resolves.toEqual({ ok: true, view: { recorded: true } });

    expect(recordEveSessionToolTrust).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      sessionId: "session-1",
      toolName: "capture_memory",
    });
  });

  it("passes a session that recorded nothing through as a quiet false", async () => {
    recordEveSessionToolTrust.mockResolvedValue({ recorded: false });

    await expect(
      recordSessionToolTrustAction({ sessionId: "session-2", toolName: "capture_memory" }),
    ).resolves.toEqual({ ok: true, view: { recorded: false } });
  });

  it("refuses an empty session id without touching the table", async () => {
    await expect(
      recordSessionToolTrustAction({ sessionId: "", toolName: "capture_memory" }),
    ).resolves.toMatchObject({ ok: false });

    expect(recordEveSessionToolTrust).not.toHaveBeenCalled();
  });

  it("refuses a tool name long enough to be bulk rather than a tool", async () => {
    await expect(
      recordSessionToolTrustAction({ sessionId: "session-1", toolName: "x".repeat(200) }),
    ).resolves.toMatchObject({ ok: false });

    expect(recordEveSessionToolTrust).not.toHaveBeenCalled();
  });

  it("records nothing when the admitted owner gate rejects the caller", async () => {
    requireAdmittedOwnerForActionSpy.mockRejectedValue(new Error("not admitted"));

    await expect(
      recordSessionToolTrustAction({ sessionId: "session-1", toolName: "capture_memory" }),
    ).rejects.toThrow("not admitted");
    expect(recordEveSessionToolTrust).not.toHaveBeenCalled();
  });
});
