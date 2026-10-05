import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The restore hold (#623) reads the database before every Resend send.
vi.mock("@tendnote/db/queries/outbound-pause", () => ({ isOutboundPaused: async () => false }));
vi.mock("@tendnote/db/queries/restored-email-fences", () => ({
  isRestoredEmailFenced: async () => false,
}));

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import { sendCancellationEmail } from "./cancellation-email";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("RESEND_API_KEY", "re_live");
  vi.stubEnv("BETTER_AUTH_URL", "https://app.tendnote.test");
  vi.stubEnv("TENDNOTE_EMAIL_FROM", "Tendnote <notifications@mail.tendnote.example>");
  vi.stubEnv("TENDNOTE_EMAIL_REPLY_TO", "support@example.test");
  resendSend.mockResolvedValue({ data: { id: "resend-1" }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const ENDS_AT = new Date("2026-04-15T17:04:05.000Z");

describe("the cancellation confirmation email (#609)", () => {
  it("confirms the cancellation and links to Billing on the account page", async () => {
    await sendCancellationEmail({
      to: "sam@example.com",
      stripeSubscriptionId: "sub_1",
      endsAt: ENDS_AT,
    });

    const [payload] = resendSend.mock.calls[0] ?? [];
    expect(payload.to).toBe("sam@example.com");
    expect(payload.subject).toBe("Your Tendnote subscription is cancelled");
    expect(payload.text).toContain("won’t renew");
    expect(payload.text).toContain("https://app.tendnote.test/account");
  });

  it("is content-free: no address, amount, or plan in either body", async () => {
    await sendCancellationEmail({
      to: "sam@example.com",
      stripeSubscriptionId: "sub_1",
      endsAt: ENDS_AT,
    });

    const [payload] = resendSend.mock.calls[0] ?? [];
    for (const body of [payload.text, payload.html]) {
      expect(body).not.toContain("sam@example.com");
      expect(body).not.toMatch(/\$\d/);
      expect(body).not.toMatch(/monthly|annual/i);
    }
  });

  it("keys each send on the cancellation, so a redelivery reuses the provider key", async () => {
    const later = new Date("2026-05-15T17:04:05.000Z");
    await sendCancellationEmail({
      to: "sam@example.com",
      stripeSubscriptionId: "sub_1",
      endsAt: ENDS_AT,
    });
    await sendCancellationEmail({
      to: "sam@example.com",
      stripeSubscriptionId: "sub_1",
      endsAt: ENDS_AT,
    });
    await sendCancellationEmail({
      to: "sam@example.com",
      stripeSubscriptionId: "sub_1",
      endsAt: later,
    });

    const keys = resendSend.mock.calls.map(([, options]) => options.idempotencyKey as string);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
