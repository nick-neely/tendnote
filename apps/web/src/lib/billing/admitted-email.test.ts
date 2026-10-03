import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import { sendAdmittedEmail } from "./admitted-email";

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

describe("the 'you're in' email (#607)", () => {
  it("tells the subscriber they're in and links to the app", async () => {
    await sendAdmittedEmail({ to: "sam@example.com", invoiceId: "in_first" });

    const [payload] = resendSend.mock.calls[0] ?? [];
    expect(payload.to).toBe("sam@example.com");
    expect(payload.subject).toBe("You’re in: your Tendnote account is ready");
    expect(payload.text).toContain("Your payment is confirmed");
    expect(payload.text).toContain("https://app.tendnote.test/");
  });

  it("is content-free: no address, name, amount, or plan in either body", async () => {
    await sendAdmittedEmail({ to: "sam@example.com", invoiceId: "in_first" });

    const [payload] = resendSend.mock.calls[0] ?? [];
    for (const body of [payload.text, payload.html]) {
      expect(body).not.toContain("sam@example.com");
      expect(body).not.toMatch(/\$\d/);
      expect(body).not.toMatch(/monthly|annual/i);
    }
  });

  it("sends one message per first paid invoice, however often it is redelivered", async () => {
    await sendAdmittedEmail({ to: "sam@example.com", invoiceId: "in_first" });
    await sendAdmittedEmail({ to: "sam@example.com", invoiceId: "in_first" });
    await sendAdmittedEmail({ to: "sam@example.com", invoiceId: "in_later" });

    const keys = resendSend.mock.calls.map(([, options]) => options.idempotencyKey as string);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
