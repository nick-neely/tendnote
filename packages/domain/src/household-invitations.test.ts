import { describe, expect, it } from "vitest";
import {
  decideHouseholdJoin,
  effectiveHouseholdInvitationState,
  HOUSEHOLD_INVITATION_RESEND_COOLDOWN_MS,
  HOUSEHOLD_INVITATION_TTL_DAYS,
  type HouseholdInvitationRecord,
  householdInvitationExpiresAt,
  isHouseholdInvitationLive,
  normalizeInvitationEmail,
  parseInvitationRecipient,
  summarizeHouseholdInvitation,
} from "./household-invitations";
import { HouseholdValidationError } from "./household-policy";

const SENT_AT = new Date("2026-08-01T09:00:00Z");

function invitation(patch: Partial<HouseholdInvitationRecord> = {}): HouseholdInvitationRecord {
  return {
    id: "invitation-1",
    householdId: "household-1",
    invitedByUserId: "owner-1",
    email: "Sam@Example.com",
    normalizedEmail: "sam@example.com",
    role: "member",
    state: "pending",
    expiresAt: householdInvitationExpiresAt(SENT_AT),
    lastSentAt: SENT_AT,
    resendCount: 0,
    ...patch,
  };
}

describe("invitation recipient parsing", () => {
  it("keeps the address the owner typed and compares on a folded copy", () => {
    expect(parseInvitationRecipient("  Sam@Example.COM  ")).toEqual({
      email: "Sam@Example.COM",
      normalizedEmail: "sam@example.com",
    });
  });

  /**
   * Trim and case-fold only. Inventing Gmail dot/plus rules would silently
   * redirect an invitation to an address the owner never typed.
   */
  it("does not invent provider-specific address rules", () => {
    expect(normalizeInvitationEmail("Sam.Smith+home@Example.com")).toBe(
      "sam.smith+home@example.com",
    );
  });

  it("refuses an address that is not an address, with a message a person can act on", () => {
    expect(() => parseInvitationRecipient("sam at example")).toThrow(HouseholdValidationError);
    expect(() => parseInvitationRecipient("sam at example")).toThrow(/email address/i);
  });

  it("refuses an empty address", () => {
    expect(() => parseInvitationRecipient("   ")).toThrow(/email address/i);
  });
});

describe("invitation lifetime", () => {
  it("expires fourteen days after it was sent", () => {
    expect(HOUSEHOLD_INVITATION_TTL_DAYS).toBe(14);
    expect(householdInvitationExpiresAt(SENT_AT).toISOString()).toBe("2026-08-15T09:00:00.000Z");
  });

  it("reads as expired once the window has passed, without waiting to be rewritten", () => {
    const stale = invitation();
    expect(effectiveHouseholdInvitationState(stale, new Date("2026-08-14T09:00:00Z"))).toBe(
      "pending",
    );
    expect(effectiveHouseholdInvitationState(stale, new Date("2026-08-16T09:00:00Z"))).toBe(
      "expired",
    );
  });

  it("leaves a terminal state alone", () => {
    const canceled = invitation({ state: "canceled" });
    expect(effectiveHouseholdInvitationState(canceled, new Date("2026-08-16T09:00:00Z"))).toBe(
      "canceled",
    );
  });

  it("counts only unexpired pending invitations as live", () => {
    expect(isHouseholdInvitationLive(invitation(), SENT_AT)).toBe(true);
    expect(isHouseholdInvitationLive(invitation(), new Date("2026-09-01T00:00:00Z"))).toBe(false);
    expect(isHouseholdInvitationLive(invitation({ state: "accepted" }), SENT_AT)).toBe(false);
  });
});

describe("owner-facing invitation summary", () => {
  it("shows the address, the derived state, and whether it can still be resent", () => {
    expect(summarizeHouseholdInvitation(invitation(), new Date("2026-08-01T09:05:00Z"))).toEqual({
      id: "invitation-1",
      email: "Sam@Example.com",
      state: "pending",
      expiresAt: new Date("2026-08-15T09:00:00.000Z"),
      canResend: true,
      canCancel: true,
    });
  });

  /** A resend rotates the link and sends mail; back-to-back presses must not. */
  it("holds resend behind a cooldown after the last explicit send", () => {
    const justSent = summarizeHouseholdInvitation(
      invitation(),
      new Date(SENT_AT.getTime() + HOUSEHOLD_INVITATION_RESEND_COOLDOWN_MS - 1000),
    );
    expect(justSent.canResend).toBe(false);
    expect(justSent.canCancel).toBe(true);
  });

  it("offers neither resend nor cancel once the invitation is terminal", () => {
    const expired = summarizeHouseholdInvitation(invitation(), new Date("2026-09-01T00:00:00Z"));
    expect(expired.state).toBe("expired");
    expect(expired.canResend).toBe(false);
    expect(expired.canCancel).toBe(false);
  });
});

describe("join decision", () => {
  const household = { id: "household-1", name: "The Neely house" };

  it("gives an unknown link the same neutral answer as a cancelled one", () => {
    const unknown = decideHouseholdJoin({ invitation: null, viewer: null, now: SENT_AT });
    const cancelled = decideHouseholdJoin({
      invitation: { invitation: invitation({ state: "canceled" }), household },
      viewer: null,
      now: SENT_AT,
    });

    expect(unknown).toEqual({ state: "unusable" });
    expect(cancelled).toEqual({ state: "unusable" });
  });

  it("gives an expired link the same neutral answer, even before it is rewritten", () => {
    expect(
      decideHouseholdJoin({
        invitation: { invitation: invitation(), household },
        viewer: null,
        now: new Date("2026-09-01T00:00:00Z"),
      }),
    ).toEqual({ state: "unusable" });
  });

  it("asks an anonymous visitor to sign in without naming the household", () => {
    const decision = decideHouseholdJoin({
      invitation: { invitation: invitation(), household },
      viewer: null,
      now: SENT_AT,
    });

    expect(decision).toEqual({ state: "sign-in-required" });
    expect(JSON.stringify(decision)).not.toContain("Neely");
  });

  it("asks a signed-in stranger for the invited address without naming either side", () => {
    const decision = decideHouseholdJoin({
      invitation: { invitation: invitation(), household },
      viewer: { userId: "other-1", email: "someone@example.com", activeHouseholds: 0 },
      now: SENT_AT,
    });

    expect(decision).toEqual({ state: "address-mismatch" });
    expect(JSON.stringify(decision)).not.toContain("sam@example.com");
    expect(JSON.stringify(decision)).not.toContain("Neely");
  });

  it("matches the invited address regardless of how it was capitalized", () => {
    expect(
      decideHouseholdJoin({
        invitation: { invitation: invitation(), household },
        viewer: { userId: "sam-1", email: "SAM@example.com", activeHouseholds: 0 },
        now: SENT_AT,
      }),
    ).toEqual({
      state: "ready",
      householdName: "The Neely house",
      role: "member",
      expiresAt: new Date("2026-08-15T09:00:00.000Z"),
    });
  });

  /**
   * The conflict is explained only after the address is proven, and it still
   * names neither household — the recipient learns that they already have one,
   * not which one they were invited to (ADR 0213).
   */
  it("explains an existing-workspace conflict privately and names no household", () => {
    const decision = decideHouseholdJoin({
      invitation: { invitation: invitation(), household },
      viewer: { userId: "sam-1", email: "sam@example.com", activeHouseholds: 1 },
      now: SENT_AT,
    });

    expect(decision).toEqual({ state: "workspace-conflict" });
    expect(JSON.stringify(decision)).not.toContain("Neely");
  });
});
