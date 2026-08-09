import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  HouseholdInvitationTransportUnavailableError,
  householdInvitationMessage,
  householdInvitationUrl,
  operatorLogInvitationTransport,
} from "./invitation-delivery";

const MESSAGE = {
  deliveryId: "delivery-1",
  to: "sam@example.com",
  householdName: "The Neely house",
  inviterName: "Alex",
  acceptUrl: "https://tendnote.test/join/one-time-secret",
  expiresAt: new Date("2026-08-15T09:00:00Z"),
};

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", "https://tendnote.example/app");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("householdInvitationUrl", () => {
  /**
   * The link is a capability. Built from an inbound `Host` header it would point
   * at whatever host an attacker asked for, and the recipient would hand their
   * invitation to that server.
   */
  it("is built from the configured origin, not from anything a request supplied", () => {
    expect(householdInvitationUrl("one-time-secret")).toBe(
      "https://tendnote.example/join/one-time-secret",
    );
  });

  it("escapes the secret so it survives as one path segment", () => {
    expect(householdInvitationUrl("a/b?c#d")).toBe("https://tendnote.example/join/a%2Fb%3Fc%23d");
  });
});

describe("the operator transport", () => {
  it("writes a message that names the household, the sender, and the deadline", () => {
    const { subject, body } = householdInvitationMessage(MESSAGE);

    expect(subject).toBe("You're invited to The Neely house on Tendnote");
    expect(body).toContain("Alex invited you to join The Neely house");
    expect(body).toContain(MESSAGE.acceptUrl);
    expect(body).toContain("only for this email address");
    expect(body).toContain("nothing happens unless you accept");
  });

  it("stands in for a provider outside production", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(operatorLogInvitationTransport(MESSAGE)).resolves.toEqual({
      providerMessageId: null,
    });
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  /**
   * A capability URL in a hosted log is a working invitation somewhere the
   * recipient's mailbox is not. With no provider configured, production refuses
   * and the attempt is recorded as a delivery failure instead.
   */
  it("refuses to stand in for one in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(operatorLogInvitationTransport(MESSAGE)).rejects.toThrow(
      HouseholdInvitationTransportUnavailableError,
    );
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
