import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { write, resendSend } = vi.hoisted(() => ({
  write: vi.fn(async () => {}),
  resendSend: vi.fn(async () => ({ providerMessageId: "resend-1" })),
}));
vi.mock("@tendnote/db/queries/effect-fences", () => ({ blobEffectFences: { write } }));
vi.mock("./resend", () => ({ createResendSender: () => resendSend }));

import { selectTransactionalSender } from "./select-sender";

const EMAIL = {
  to: "owner@example.test",
  subject: "Subject",
  html: "<p>Body</p>",
  text: "Body",
  idempotencyKey: "refund:r_1",
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("selecting the transactional sender", () => {
  it("fences every message Resend delivers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_live");
    vi.stubEnv("TENDNOTE_EMAIL_FROM", "Tendnote <notifications@mail.operator.example>");
    vi.stubEnv("TENDNOTE_EMAIL_REPLY_TO", "support@example.test");

    await selectTransactionalSender()(EMAIL);

    expect(resendSend).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ effect: "email", key: "refund:r_1" }),
    );
  });

  it("fences nothing the operator log prints", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});

    await selectTransactionalSender()(EMAIL);

    expect(resendSend).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
