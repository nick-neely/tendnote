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

import { sendDeletionNoticeEmail, sendPurgeConfirmationEmail } from "./deletion-notice-email";

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

const DEADLINE = new Date("2027-01-02T12:00:00.000Z");

async function sentNotice(
  kind: "lapsed" | "terminated",
  stage: "day_0" | "day_60" | "day_83",
): Promise<{ subject: string; text: string; html: string; idempotencyKey: string }> {
  await sendDeletionNoticeEmail({
    to: "sam@example.com",
    userId: "user_1",
    kind,
    stage,
    retentionDeadline: DEADLINE,
  });
  const [payload, options] = resendSend.mock.calls.at(-1) ?? [];
  return { ...payload, idempotencyKey: options?.idempotencyKey };
}

describe("the deletion notices (#621)", () => {
  it("tells a Lapsed Account on day 0 its deletion date, and links to resubscribe and export", async () => {
    const email = await sentNotice("lapsed", "day_0");

    expect(email.subject).toBe("Your Tendnote subscription has ended");
    expect(email.text).toContain("kept until January 2, 2027");
    expect(email.text).toContain("Resubscribe or export");
    expect(email.text).toContain("https://app.tendnote.test/lapsed");
  });

  it("names the date on days 60 and 83, the last as the final notice", async () => {
    const day60 = await sentNotice("lapsed", "day_60");
    const day83 = await sentNotice("lapsed", "day_83");

    expect(day60.subject).toBe("Your Tendnote data will be deleted on January 2, 2027");
    expect(day60.text).not.toMatch(/last notice/i);
    expect(day83.subject).toBe(day60.subject);
    expect(day83.html).toContain("Last notice before your data is deleted");
    expect(day83.text).toContain("will be deleted on January 2, 2027");
  });

  it("never offers a Terminated account a subscription, only export", async () => {
    for (const stage of ["day_0", "day_60", "day_83"] as const) {
      const email = await sentNotice("terminated", stage);
      for (const body of [email.text, email.html]) {
        expect(body).not.toMatch(/subscribe/i);
        expect(body).toContain("https://app.tendnote.test/restricted");
      }
      expect(email.text).toContain("Export your data");
    }
  });

  it("keys each notice on the account, the deadline, and the stage", async () => {
    const email = await sentNotice("lapsed", "day_60");

    expect(email.idempotencyKey).toBe(`deletion-notice:user_1:${DEADLINE.getTime()}:day_60`);
  });

  it("is content-free beyond the deletion date", async () => {
    const email = await sentNotice("lapsed", "day_0");

    for (const body of [email.text, email.html]) {
      expect(body).not.toContain("sam@example.com");
      expect(body).not.toContain("user_1");
      expect(body).not.toMatch(/\$\d|monthly|annual/i);
    }
  });
});

describe("the deletion confirmation (#621)", () => {
  it("confirms the account is gone, with no link back into the app", async () => {
    const requestedAt = new Date("2027-01-02T12:10:00.000Z");
    await sendPurgeConfirmationEmail({ to: "sam@example.com", userId: "user_1", requestedAt });

    const [payload, options] = resendSend.mock.calls[0] ?? [];
    expect(payload.to).toBe("sam@example.com");
    expect(payload.subject).toBe("Your Tendnote account has been deleted");
    expect(payload.text).toContain("backup copies expire within 7 days");
    expect(payload.text).not.toContain("https://app.tendnote.test");
    expect(payload.text).not.toContain("Button not working");
    expect(options?.idempotencyKey).toBe(`deletion-confirmation:user_1:${requestedAt.getTime()}`);
  });
});
