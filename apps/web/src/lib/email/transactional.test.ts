import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_EMAIL_FROM,
  decideTransactionalTransport,
  EmailTransportUnavailableError,
  operatorLogSender,
  resolveSenderIdentity,
  resolveSupportEmail,
  SYNTHETIC_SUPPORT_EMAIL,
  unavailableSender,
} from "./transactional";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("choosing a transport", () => {
  it("sends through Resend as soon as a key is present", () => {
    expect(
      decideTransactionalTransport({
        NODE_ENV: "production",
        RESEND_API_KEY: "re_live",
        TENDNOTE_EMAIL_FROM: "Tendnote <notifications@mail.operator.example>",
        TENDNOTE_EMAIL_REPLY_TO: "support@example.test",
      }),
    ).toEqual({ kind: "resend", apiKey: "re_live" });

    // Also outside production: a preview deployment and a developer smoke test
    // both need a way to send one real message.
    expect(
      decideTransactionalTransport({
        NODE_ENV: "development",
        RESEND_API_KEY: " re_dev ",
        TENDNOTE_EMAIL_FROM: "Tendnote <notifications@mail.operator.example>",
        TENDNOTE_EMAIL_REPLY_TO: "support@example.test",
      }),
    ).toEqual({ kind: "resend", apiKey: "re_dev" });
  });

  it("writes to the operator log when no key is configured outside production", () => {
    expect(decideTransactionalTransport({ NODE_ENV: "development" })).toEqual({
      kind: "operator-log",
    });
    expect(decideTransactionalTransport({ NODE_ENV: "development", RESEND_API_KEY: "  " })).toEqual(
      { kind: "operator-log" },
    );
  });

  /**
   * A developer with a live key in their shell must not discover it by mailing
   * a fixture's address from a unit test.
   */
  it("never sends from the test runner, whatever the ambient environment holds", () => {
    expect(decideTransactionalTransport({ NODE_ENV: "test", RESEND_API_KEY: "re_live" })).toEqual({
      kind: "operator-log",
    });
  });

  /**
   * Production with no key is a misconfiguration, not a mode. Falling back to
   * the operator log would write a working capability URL into a hosted log,
   * which is a live household invitation somewhere the recipient's mailbox is
   * not — so it refuses, and says what to do about it.
   */
  it("refuses in production without a key, and names the fix", () => {
    const choice = decideTransactionalTransport({ NODE_ENV: "production" });

    expect(choice.kind).toBe("unavailable");
    expect(choice.kind === "unavailable" && choice.reason).toMatch(/RESEND_API_KEY/);
    expect(choice.kind === "unavailable" && choice.reason).toMatch(/docs\/email-setup\.md/);
  });

  it("refuses a configured provider when the operator support contact is absent", () => {
    const choice = decideTransactionalTransport({
      NODE_ENV: "production",
      RESEND_API_KEY: "re_live",
    });

    expect(choice.kind).toBe("unavailable");
    expect(choice.kind === "unavailable" && choice.reason).toMatch(/TENDNOTE_EMAIL_REPLY_TO/);
  });

  it("refuses a configured provider when the operator sender is absent", () => {
    const choice = decideTransactionalTransport({
      NODE_ENV: "production",
      RESEND_API_KEY: "re_live",
      TENDNOTE_EMAIL_REPLY_TO: "support@operator.example",
    });

    expect(choice.kind).toBe("unavailable");
    expect(choice.kind === "unavailable" && choice.reason).toMatch(/TENDNOTE_EMAIL_FROM/);
  });
});

describe("who the mail is from", () => {
  it("sends from the transactional subdomain and replies to the support inbox", () => {
    expect(resolveSupportEmail({})).toBe(SYNTHETIC_SUPPORT_EMAIL);
    expect(resolveSupportEmail({ NODE_ENV: "production" })).toBeNull();
    expect(resolveSenderIdentity({})).toEqual({
      from: DEFAULT_EMAIL_FROM,
      replyTo: SYNTHETIC_SUPPORT_EMAIL,
    });
    expect(DEFAULT_EMAIL_FROM).toContain("@mail.tendnote.example");
    // A monitored mailbox, not a `noreply@`: people answer a message about being
    // invited into someone's home.
    expect(DEFAULT_EMAIL_FROM).not.toMatch(/noreply|no-reply|donotreply/i);
  });

  it("uses the operator contact for displayed and reply addresses", () => {
    expect(resolveSupportEmail({ TENDNOTE_EMAIL_REPLY_TO: " support@operator.example " })).toBe(
      "support@operator.example",
    );
    expect(
      resolveSenderIdentity({
        NODE_ENV: "production",
        TENDNOTE_EMAIL_FROM: "Tendnote <notifications@mail.operator.example>",
        TENDNOTE_EMAIL_REPLY_TO: "support@operator.example",
      }).replyTo,
    ).toBe("support@operator.example");
  });

  it("does not use the reserved sender for a real-send identity", () => {
    expect(() =>
      resolveSenderIdentity({
        NODE_ENV: "production",
        RESEND_API_KEY: "re_live",
        TENDNOTE_EMAIL_REPLY_TO: "support@operator.example",
      }),
    ).toThrow(/TENDNOTE_EMAIL_FROM/);
  });

  it("lets a deployment that must not send as production override both", () => {
    expect(
      resolveSenderIdentity({
        TENDNOTE_EMAIL_FROM: " Tendnote Preview <preview@mail.example.test> ",
        TENDNOTE_EMAIL_REPLY_TO: "ops@example.test",
      }),
    ).toEqual({
      from: "Tendnote Preview <preview@mail.example.test>",
      replyTo: "ops@example.test",
    });
  });
});

describe("the transports themselves", () => {
  it("stands in for a provider by writing the message an operator can act on", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(
      operatorLogSender({
        to: "sam@example.com",
        subject: "You're invited to The Neely house on Tendnote",
        html: "<p>ignored</p>",
        text: "Join here: https://tendnote.test/join/one-time-secret",
        idempotencyKey: "delivery-1",
      }),
    ).resolves.toEqual({ providerMessageId: null });

    const written = info.mock.calls[0]?.[0] as string;
    expect(written).toContain("sam@example.com");
    expect(written).toContain("delivery-1");
    // The plain-text body, not the markup: the point is a link an operator can
    // hand over, not an email to read in a terminal.
    expect(written).toContain("https://tendnote.test/join/one-time-secret");
    expect(written).not.toContain("<p>");
  });

  it("fails by a name the delivery attempt can record", async () => {
    const send = unavailableSender("RESEND_API_KEY is not set.");

    await expect(
      send({
        to: "sam@example.com",
        subject: "s",
        html: "h",
        text: "t",
        idempotencyKey: "delivery-1",
      }),
    ).rejects.toSatisfy(
      (error: Error) =>
        error instanceof EmailTransportUnavailableError &&
        error.name === "EmailTransportUnavailableError",
    );
  });
});
