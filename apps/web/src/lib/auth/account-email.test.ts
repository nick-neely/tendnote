import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { resendSend, afterCallbacks } = vi.hoisted(() => ({
  resendSend: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void>>,
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => afterCallbacks.push(callback),
}));

import { EmailTransportUnavailableError } from "@/lib/email/transactional";
import { accountEmailHooks, sendAccountEmail } from "./account-email";

const VERIFY = {
  purpose: "verify-email" as const,
  to: "sam@example.com",
  url: "https://app.tendnote.test/api/auth/verify-email?token=verify-secret",
  token: "verify-secret",
};

const RESET = {
  purpose: "reset-password" as const,
  to: "sam@example.com",
  url: "https://app.tendnote.test/api/auth/reset-password/reset-secret?callbackURL=%2Freset-password",
  token: "reset-secret",
};

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  vi.stubEnv("TENDNOTE_EMAIL_FROM", "Tendnote <notifications@mail.tendnote.example>");
  vi.stubEnv("TENDNOTE_EMAIL_REPLY_TO", "support@example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function sendThroughResend() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("RESEND_API_KEY", "re_live");
  resendSend.mockResolvedValue({ data: { id: "resend-1" }, error: null });
}

describe("account emails through the transactional seam", () => {
  it("sends the verification link to the address that signed up", async () => {
    sendThroughResend();

    await sendAccountEmail(VERIFY);

    const [payload] = resendSend.mock.calls[0] ?? [];
    expect(payload.to).toBe("sam@example.com");
    expect(payload.subject).toBe("Confirm your email for Tendnote");
    expect(payload.text).toContain(VERIFY.url);
    expect(payload.html).toContain("Confirm email");
  });

  it("sends the password-reset link to the account's address", async () => {
    sendThroughResend();

    await sendAccountEmail(RESET);

    const [payload] = resendSend.mock.calls[0] ?? [];
    expect(payload.to).toBe("sam@example.com");
    expect(payload.subject).toBe("Reset your Tendnote password");
    expect(payload.text).toContain(RESET.url);
    expect(payload.text).toContain("your password stays the same");
  });

  it("keeps the token out of the provider's idempotency key but stays stable per token", async () => {
    sendThroughResend();

    await sendAccountEmail(RESET);
    await sendAccountEmail(RESET);
    await sendAccountEmail({ ...RESET, token: "another-secret" });

    const keys = resendSend.mock.calls.map(([, options]) => options.idempotencyKey as string);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    for (const key of keys) expect(key).not.toContain("secret");
  });

  it("is content-free: nothing about the account appears in either body", async () => {
    sendThroughResend();

    await sendAccountEmail(VERIFY);

    const [payload] = resendSend.mock.calls[0] ?? [];
    expect(payload.text).not.toContain("sam@example.com");
    expect(payload.html).not.toContain("sam@example.com");
  });

  it("writes the message to the operator log when no provider is configured", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendAccountEmail(VERIFY);

    expect(info.mock.calls[0]?.[0]).toContain(VERIFY.url);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("refuses by name in production without a provider", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(sendAccountEmail(VERIFY)).rejects.toBeInstanceOf(EmailTransportUnavailableError);
  });
});

describe("the Better Auth hooks", () => {
  it("send each purpose's email to the account's address", async () => {
    sendThroughResend();

    await accountEmailHooks.sendVerificationEmail({
      user: { email: VERIFY.to },
      url: VERIFY.url,
      token: VERIFY.token,
    });
    await accountEmailHooks.sendResetPassword({
      user: { email: RESET.to },
      url: RESET.url,
      token: RESET.token,
    });
    for (const callback of afterCallbacks) await callback();

    expect(resendSend.mock.calls.map(([payload]) => [payload.subject, payload.to])).toEqual([
      ["Confirm your email for Tendnote", "sam@example.com"],
      ["Reset your Tendnote password", "sam@example.com"],
    ]);
  });

  it("defer the send, so response time says nothing about the address", async () => {
    sendThroughResend();

    await accountEmailHooks.sendVerificationEmail({
      user: { email: VERIFY.to },
      url: VERIFY.url,
      token: VERIFY.token,
    });
    expect(resendSend).not.toHaveBeenCalled();

    await afterCallbacks[0]?.();
    expect(resendSend).toHaveBeenCalledOnce();
  });

  it("logs a failed send by its class, without the link or the address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await accountEmailHooks.sendResetPassword({
      user: { email: RESET.to },
      url: RESET.url,
      token: RESET.token,
    });
    await afterCallbacks[0]?.();

    const logged = error.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("EmailTransportUnavailableError");
    expect(logged).not.toContain("reset-secret");
    expect(logged).not.toContain("sam@example.com");
  });
});
