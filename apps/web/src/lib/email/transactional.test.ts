import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_EMAIL_FROM,
  decideTransactionalTransport,
  EmailTransportUnavailableError,
  operatorLogSender,
  resolveSenderIdentity,
  unavailableSender,
} from "./transactional";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("choosing a transport", () => {
  it("sends through Resend as soon as a key is present", () => {
    expect(
      decideTransactionalTransport({ NODE_ENV: "production", RESEND_API_KEY: "re_live" }),
    ).toEqual({ kind: "resend", apiKey: "re_live" });

    // Also outside production: a preview deployment and a developer smoke test
    // both need a way to send one real message.
    expect(
      decideTransactionalTransport({ NODE_ENV: "development", RESEND_API_KEY: " re_dev " }),
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
});

describe("who the mail is from", () => {
  it("sends from the transactional subdomain and replies to the support inbox", () => {
    expect(resolveSenderIdentity({})).toEqual({
      from: DEFAULT_EMAIL_FROM,
      replyTo: "support@tendnote.example",
    });
    expect(DEFAULT_EMAIL_FROM).toContain("@mail.tendnote.example");
    // A monitored mailbox, not a `noreply@`: people answer a message about being
    // invited into someone's home.
    expect(DEFAULT_EMAIL_FROM).not.toMatch(/noreply|no-reply|donotreply/i);
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
