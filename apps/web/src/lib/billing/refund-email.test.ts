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

import { sendRefundEmail } from "./refund-email";

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

describe("the refund confirmation email (#617)", () => {
  it("confirms the refund, leaves its timing to the card issuer, and links to the account", async () => {
    await sendRefundEmail({ to: "sam@example.com", refundRecordId: "refund-record-1" });

    const [payload] = resendSend.mock.calls[0] ?? [];
    expect(payload.to).toBe("sam@example.com");
    expect(payload.subject).toBe("Your Tendnote refund is on its way");
    expect(payload.text).toContain("up to your card issuer");
    expect(payload.text).toContain("https://app.tendnote.test/account");
  });

  it("is content-free: no address, amount, plan, card, or date in either body", async () => {
    await sendRefundEmail({ to: "sam@example.com", refundRecordId: "refund-record-1" });

    const [payload] = resendSend.mock.calls[0] ?? [];
    for (const body of [payload.text, payload.html]) {
      expect(body).not.toContain("sam@example.com");
      expect(body).not.toMatch(/\$\d/);
      expect(body).not.toMatch(/monthly|annual/i);
      expect(body).not.toContain("refund-record-1");
    }
    // No date, year, or card digits.
    expect(payload.text).not.toMatch(/\d{4}/);
  });

  it("keys each send on the Refund record, so a redelivery reuses the provider key", async () => {
    await sendRefundEmail({ to: "sam@example.com", refundRecordId: "refund-record-1" });
    await sendRefundEmail({ to: "sam@example.com", refundRecordId: "refund-record-1" });
    await sendRefundEmail({ to: "sam@example.com", refundRecordId: "refund-record-2" });

    const keys = resendSend.mock.calls.map(([, options]) => options.idempotencyKey as string);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
