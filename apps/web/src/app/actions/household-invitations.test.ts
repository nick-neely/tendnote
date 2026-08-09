import { HouseholdValidationError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceProductBudgetSpy,
  getCurrentAccessSpy,
  requireAdmittedOwnerForActionSpy,
  updateTagSpy,
} from "@/test/action-adapter-mocks";

const db = vi.hoisted(() => ({
  sendHouseholdInvitation: vi.fn(),
  resendHouseholdInvitation: vi.fn(),
  cancelHouseholdInvitation: vi.fn(),
  acceptHouseholdInvitation: vi.fn(),
  declineHouseholdInvitation: vi.fn(),
  dispatchHouseholdInvitationDelivery: vi.fn(),
  getHouseholdOverviewForUser: vi.fn(),
  listActiveHouseholdMembershipsForUser: vi.fn(),
}));

vi.mock("@tendnote/db/queries/households", () => db);

// The route's request headers back the source-fingerprint budget; the action is
// exercised outside a request here, so `headers()` is stood in for.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
}));
// `after` schedules delivery past the response. The test runs the callback
// immediately, which is what lets it assert on what the transport was handed.
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void> | void) => {
    void callback();
  },
}));

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock("@/lib/household/invitation-delivery", () => ({
  getHouseholdInvitationTransport: () => transport,
  householdInvitationUrl: (secret: string) => `https://tendnote.test/join/${secret}`,
}));

import {
  acceptHouseholdInvitationAction,
  cancelHouseholdInvitationAction,
  declineHouseholdInvitationAction,
  resendHouseholdInvitationAction,
  sendHouseholdInvitationAction,
} from "./household-invitations";

const OVERVIEW = {
  householdId: "household-1",
  name: "The Neely house",
  viewerRole: "owner" as const,
  isSoleMember: true,
  invitations: [],
  seats: { limit: 8, occupied: 1, remaining: 7, isFull: false },
  members: [],
};

const SENT = {
  invitation: {
    id: "invitation-1",
    email: "sam@example.com",
    state: "pending" as const,
    expiresAt: new Date("2026-08-15T09:00:00Z"),
    canResend: false,
    canCancel: true,
  },
  deliveryId: "delivery-1",
  secret: "one-time-secret",
  householdName: "The Neely house",
  inviterName: "Alex",
};

const INVITATION_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  db.listActiveHouseholdMembershipsForUser.mockResolvedValue([{ householdId: "household-1" }]);
  db.sendHouseholdInvitation.mockResolvedValue(SENT);
  db.resendHouseholdInvitation.mockResolvedValue(SENT);
  db.cancelHouseholdInvitation.mockResolvedValue(SENT.invitation);
  db.getHouseholdOverviewForUser.mockResolvedValue(OVERVIEW);
  db.dispatchHouseholdInvitationDelivery.mockImplementation(
    async (input: { send: () => Promise<unknown> }) => {
      await input.send();
      return { status: "sent" as const };
    },
  );
  transport.mockResolvedValue({ providerMessageId: "provider-1" });
});

describe("sendHouseholdInvitationAction", () => {
  it("sends for the session owner and answers with their refreshed overview", async () => {
    await expect(sendHouseholdInvitationAction({ email: "sam@example.com" })).resolves.toEqual({
      ok: true,
      view: OVERVIEW,
    });

    expect(db.sendHouseholdInvitation).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      email: "sam@example.com",
    });
    expect(updateTagSpy).toHaveBeenCalled();
  });

  /**
   * Seat capacity is not an abuse control, so the invitation category is charged
   * at three independent keys — inviter, household, and a non-reversible handle
   * for the recipient — before anything is created.
   */
  it("charges all five independent abuse budgets before creating anything", async () => {
    await sendHouseholdInvitationAction({ email: "sam@example.com" });

    const charges = enforceProductBudgetSpy.mock.calls.map(([request]) => request);
    expect(charges.map((charge) => charge.costCategory)).toEqual([
      "household-invitation-inviter",
      "household-invitation-household",
      "household-invitation-source",
      "household-invitation-delivery",
      "household-invitation-recipient",
    ]);
    expect(charges[0]?.subject).toBe("owner-1");
    expect(charges[1]?.subject).toBe("household-1");
    // Source and recipient are non-reversible handles, never the raw values.
    expect(charges[2]?.subject).not.toContain("203.0.113");
    expect(charges[4]?.subject).not.toContain("sam@example.com");
    // The provider-wide ceiling belongs to the deployment, not to any caller.
    expect(charges[3]?.subject).toBe("deployment");
  });

  it("does not create the invitation when a budget refuses", async () => {
    enforceProductBudgetSpy.mockRejectedValueOnce(new Error("limit"));

    await expect(sendHouseholdInvitationAction({ email: "sam@example.com" })).rejects.toThrow();
    expect(db.sendHouseholdInvitation).not.toHaveBeenCalled();
  });

  it("hands the one-time link to the transport under the durable attempt's claim", async () => {
    await sendHouseholdInvitationAction({ email: "sam@example.com" });

    expect(db.dispatchHouseholdInvitationDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: "delivery-1" }),
    );
    expect(transport).toHaveBeenCalledWith({
      deliveryId: "delivery-1",
      to: "sam@example.com",
      householdName: "The Neely house",
      inviterName: "Alex",
      acceptUrl: "https://tendnote.test/join/one-time-secret",
      expiresAt: SENT.invitation.expiresAt,
    });
  });

  it("renders the domain's own refusal rather than a second copy of it", async () => {
    db.sendHouseholdInvitation.mockRejectedValue(
      new HouseholdValidationError("That person is already in this household."),
    );

    await expect(sendHouseholdInvitationAction({ email: "sam@example.com" })).resolves.toEqual({
      ok: false,
      error: "That person is already in this household.",
    });
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  it("refuses an owner smuggled in by the caller instead of honoring it", async () => {
    const result = await sendHouseholdInvitationAction({
      email: "sam@example.com",
      ownerUserId: "someone-else",
    } as never);

    expect(result.ok).toBe(false);
    expect(db.sendHouseholdInvitation).not.toHaveBeenCalled();
  });
});

describe("resendHouseholdInvitationAction", () => {
  it("rotates the invitation and charges the recipient budget before sending again", async () => {
    await expect(resendHouseholdInvitationAction({ invitationId: INVITATION_ID })).resolves.toEqual(
      { ok: true, view: OVERVIEW },
    );

    expect(db.resendHouseholdInvitation).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      invitationId: INVITATION_ID,
    });
    expect(enforceProductBudgetSpy.mock.calls.map(([request]) => request.costCategory)).toEqual([
      "household-invitation-inviter",
      "household-invitation-household",
      "household-invitation-source",
      "household-invitation-delivery",
      "household-invitation-recipient",
    ]);
    expect(transport).toHaveBeenCalled();
  });
});

describe("cancelHouseholdInvitationAction", () => {
  it("cancels without handing anything to the transport", async () => {
    await expect(cancelHouseholdInvitationAction({ invitationId: INVITATION_ID })).resolves.toEqual(
      { ok: true, view: OVERVIEW },
    );

    expect(db.cancelHouseholdInvitation).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      invitationId: INVITATION_ID,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(db.dispatchHouseholdInvitationDelivery).not.toHaveBeenCalled();
  });
});

describe("accepting and declining", () => {
  beforeEach(() => {
    getCurrentAccessSpy.mockResolvedValue({
      state: "admitted",
      ownerUserId: "sam-1",
      user: { id: "sam-1", email: "sam@example.com", name: "Sam" },
      decision: { admitted: true },
    });
  });

  it("presents the session's own proven identity, never one the caller supplied", async () => {
    db.acceptHouseholdInvitation.mockResolvedValue({ householdId: "household-1" });

    await expect(
      acceptHouseholdInvitationAction({
        secret: "one-time-secret",
        userId: "someone-else",
      } as never),
    ).resolves.toEqual({ ok: false, error: expect.any(String), terminal: false });
    expect(db.acceptHouseholdInvitation).not.toHaveBeenCalled();

    await expect(acceptHouseholdInvitationAction({ secret: "one-time-secret" })).resolves.toEqual({
      ok: true,
    });
    expect(db.acceptHouseholdInvitation).toHaveBeenCalledWith({
      secret: "one-time-secret",
      userId: "sam-1",
      userEmail: "sam@example.com",
    });
  });

  it("refuses a caller who is not signed in, without touching the capability", async () => {
    getCurrentAccessSpy.mockResolvedValue({ state: "unauthenticated" });

    await expect(acceptHouseholdInvitationAction({ secret: "one-time-secret" })).resolves.toEqual({
      ok: false,
      error: "Sign in with the invited email address to continue.",
      terminal: false,
    });
    expect(db.acceptHouseholdInvitation).not.toHaveBeenCalled();
  });

  /**
   * A dead link, someone else's link, and an expired one must read alike — and
   * all of them are over, so none of them offers a retry.
   */
  it("passes the lifecycle's one neutral refusal through as a terminal outcome", async () => {
    const neutral =
      "This invitation link can't be used. Ask whoever invited you to send a new one.";
    db.acceptHouseholdInvitation.mockRejectedValue(new HouseholdValidationError(neutral));

    await expect(acceptHouseholdInvitationAction({ secret: "one-time-secret" })).resolves.toEqual({
      ok: false,
      error: neutral,
      terminal: true,
    });
  });

  /** An infrastructure failure is a hiccup, not an ending: it stays retryable. */
  it("never renders an infrastructure failure to the recipient", async () => {
    db.acceptHouseholdInvitation.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.4:5432"));

    const result = await acceptHouseholdInvitationAction({ secret: "one-time-secret" });

    expect(result).toEqual({
      ok: false,
      error: "That didn't go through. Nothing changed, so you can try again.",
      terminal: false,
    });
  });

  it("declines with the same identity proof acceptance requires", async () => {
    db.declineHouseholdInvitation.mockResolvedValue(undefined);

    await expect(declineHouseholdInvitationAction({ secret: "one-time-secret" })).resolves.toEqual({
      ok: true,
    });
    expect(db.declineHouseholdInvitation).toHaveBeenCalledWith({
      secret: "one-time-secret",
      userId: "sam-1",
      userEmail: "sam@example.com",
    });
  });
});
