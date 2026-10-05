import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { write, resendSend, isOutboundPaused, isRestoredEmailFenced } = vi.hoisted(() => ({
  write: vi.fn(async () => {}),
  resendSend: vi.fn(async () => ({ providerMessageId: "resend-1" })),
  isOutboundPaused: vi.fn(async () => false),
  isRestoredEmailFenced: vi.fn(async (_input: { digest: string }) => false),
}));
vi.mock("@tendnote/db/queries/effect-fences", () => ({ blobEffectFences: { write } }));
vi.mock("@tendnote/db/queries/outbound-pause", () => ({ isOutboundPaused }));
vi.mock("@tendnote/db/queries/restored-email-fences", () => ({ isRestoredEmailFenced }));
vi.mock("./resend", () => ({ createResendSender: () => resendSend }));

import { effectFenceDigest } from "@tendnote/domain";
import { selectTransactionalSender } from "./select-sender";

const EMAIL = {
  to: "owner@example.test",
  subject: "Subject",
  html: "<p>Body</p>",
  text: "Body",
  idempotencyKey: "refund:r_1",
};

beforeEach(() => {
  vi.clearAllMocks();
  isOutboundPaused.mockResolvedValue(false);
});

function useResend() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RESEND_API_KEY", "re_live");
  vi.stubEnv("TENDNOTE_EMAIL_FROM", "Tendnote <notifications@mail.operator.example>");
  vi.stubEnv("TENDNOTE_EMAIL_REPLY_TO", "support@example.test");
}
afterEach(() => vi.unstubAllEnvs());

describe("selecting the transactional sender", () => {
  it("fences every message Resend delivers", async () => {
    useResend();

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

  it("sends nothing while a restore holds outbound, and fails the attempt for a retry", async () => {
    useResend();
    isOutboundPaused.mockResolvedValueOnce(true);

    await expect(selectTransactionalSender()(EMAIL)).rejects.toMatchObject({
      name: "EmailTransportUnavailableError",
    });
    expect(resendSend).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("completes a send a restore found fenced without sending it again, even while paused", async () => {
    useResend();
    isOutboundPaused.mockResolvedValue(true);
    isRestoredEmailFenced.mockResolvedValueOnce(true);

    await expect(selectTransactionalSender()(EMAIL)).resolves.toEqual({ providerMessageId: null });
    expect(isRestoredEmailFenced).toHaveBeenCalledWith({
      digest: effectFenceDigest("refund:r_1"),
    });
    expect(resendSend).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
