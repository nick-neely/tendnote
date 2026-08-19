import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import { EmailTransportUnavailableError } from "@/lib/email/transactional";
import { getHouseholdInvitationTransport, householdInvitationUrl } from "./invitation-delivery";

const MESSAGE = {
  deliveryId: "delivery-1",
  to: "sam@example.com",
  householdName: "The Neely house",
  inviterName: "Alex",
  acceptUrl: "https://tendnote.test/join/one-time-secret",
  expiresAt: new Date("2026-08-15T09:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BETTER_AUTH_URL", "https://tendnote.example/app");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

describe("the transport the app is handed", () => {
  it("renders the invitation and writes it where an operator can act on it", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(getHouseholdInvitationTransport()(MESSAGE)).resolves.toEqual({
      providerMessageId: null,
    });

    const written = info.mock.calls[0]?.[0] as string;
    expect(written).toContain("You're invited to The Neely house on Tendnote");
    expect(written).toContain("Alex invited you to join their household on Tendnote");
    expect(written).toContain(MESSAGE.acceptUrl);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("hands the rendered message to Resend once a key is configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "re_live");
    resendSend.mockResolvedValue({ data: { id: "resend-1" }, error: null });

    await expect(getHouseholdInvitationTransport()(MESSAGE)).resolves.toEqual({
      providerMessageId: "resend-1",
    });

    const [payload, options] = resendSend.mock.calls[0] ?? [];
    expect(payload.to).toBe("sam@example.com");
    expect(payload.from).toBe("Tendnote <notifications@mail.tendnote.example>");
    expect(payload.replyTo).toBe("support@tendnote.example");
    expect(payload.subject).toBe("You're invited to The Neely house on Tendnote");
    expect(payload.html).toContain(MESSAGE.acceptUrl);
    expect(payload.text).toContain(MESSAGE.acceptUrl);
    // The durable attempt id, so an ambiguous retry cannot become two messages.
    expect(options).toEqual({ idempotencyKey: "delivery-1" });
  });

  /**
   * A capability URL in a hosted log is a working invitation somewhere the
   * recipient's mailbox is not. With no provider configured, production refuses
   * and the attempt is recorded as a delivery failure instead.
   */
  it("refuses to stand in for a provider in production, and says what is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const failure = await getHouseholdInvitationTransport()(MESSAGE).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(EmailTransportUnavailableError);
    expect((failure as Error).message).toMatch(/RESEND_API_KEY/);
    expect(info).not.toHaveBeenCalled();
  });
});
