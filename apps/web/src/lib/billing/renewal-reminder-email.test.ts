import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import { sendRenewalReminderEmail } from "./renewal-reminder-email";

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

const RENEWS_AT = new Date("2027-03-15T17:04:05.000Z");

describe("the annual renewal reminder email (#611)", () => {
  it("says the subscription renews and links to Billing on the account page", async () => {
    await sendRenewalReminderEmail({
      to: "sam@example.com",
      stripeSubscriptionId: "sub_1",
      renewsAt: RENEWS_AT,
    });

    const [payload] = resendSend.mock.calls[0] ?? [];
    expect(payload.to).toBe("sam@example.com");
    expect(payload.subject).toBe("Your Tendnote subscription renews soon");
    expect(payload.text).toContain("will renew soon");
    expect(payload.text).toContain("https://app.tendnote.test/account");
  });

  it("is content-free: no address, amount, plan, or date in either body", async () => {
    await sendRenewalReminderEmail({
      to: "sam@example.com",
      stripeSubscriptionId: "sub_1",
      renewsAt: RENEWS_AT,
    });

    const [payload] = resendSend.mock.calls[0] ?? [];
    for (const body of [payload.text, payload.html]) {
      expect(body).not.toContain("sam@example.com");
      expect(body).not.toContain("sub_1");
      expect(body).not.toMatch(/\$\d/);
      expect(body).not.toMatch(/monthly|annual|yearly/i);
      expect(body).not.toMatch(/March|2027/);
    }
  });

  it("keys each send on the renewal, so a redelivery reuses the provider key and next year's does not", async () => {
    const nextYear = new Date("2028-03-15T17:04:05.000Z");
    for (const renewsAt of [RENEWS_AT, RENEWS_AT, nextYear]) {
      await sendRenewalReminderEmail({
        to: "sam@example.com",
        stripeSubscriptionId: "sub_1",
        renewsAt,
      });
    }

    const keys = resendSend.mock.calls.map(([, options]) => options.idempotencyKey as string);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
