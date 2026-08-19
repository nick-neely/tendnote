import { describe, expect, it, vi } from "vitest";

import { createResendSender, type ResendEmails, ResendSendError } from "./resend";

const IDENTITY = {
  from: "Tendnote <notifications@mail.tendnote.example>",
  replyTo: "support@example.test",
};

const EMAIL = {
  to: "sam@example.com",
  subject: "You're invited to The Neely house on Tendnote",
  html: "<p>Join</p>",
  text: "Join",
  idempotencyKey: "delivery-1",
};

/** A stand-in for the one Resend call, typed by the seam the adapter declares. */
const resendSend = () => vi.fn<ResendEmails["send"]>();

function senderWith(send: ResendEmails["send"]) {
  return createResendSender({ apiKey: "re_test", identity: IDENTITY, client: { send } });
}

describe("the Resend adapter", () => {
  it("sends both bodies, from the configured identity, under the attempt id", async () => {
    const send = resendSend().mockResolvedValue({ data: { id: "resend-1" }, error: null });

    await expect(senderWith(send)(EMAIL)).resolves.toEqual({ providerMessageId: "resend-1" });

    expect(send).toHaveBeenCalledWith(
      {
        from: IDENTITY.from,
        to: "sam@example.com",
        replyTo: IDENTITY.replyTo,
        subject: EMAIL.subject,
        html: EMAIL.html,
        text: EMAIL.text,
      },
      // The durable attempt id verbatim, so an ambiguous retry cannot become
      // two messages inside Resend's 24-hour deduplication window.
      { idempotencyKey: "delivery-1" },
    );
  });

  /**
   * Resend returns its failures rather than throwing them. An unchecked call
   * would mark the attempt `sent` and record a null provider id for a message
   * that was never accepted.
   */
  it("treats a returned error as a failure rather than a quiet success", async () => {
    const send = resendSend().mockResolvedValue({
      data: null,
      error: {
        name: "validation_error",
        message: "sam@example.com is suppressed",
        statusCode: 422,
      },
    });

    const failure = await senderWith(send)(EMAIL).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(ResendSendError);
    expect((failure as Error).name).toBe("ResendSendError");
    // The class, never the provider's sentence: what Resend knows about the
    // recipient is not the Owner's to read.
    expect((failure as Error).message).not.toContain("sam@example.com");
    expect((failure as Error).message).not.toContain("suppressed");
  });

  it("gives a network failure the same class a refusal gets", async () => {
    const send = resendSend().mockRejectedValue(new Error("connect ETIMEDOUT 10.0.0.4:443"));

    const failure = await senderWith(send)(EMAIL).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(ResendSendError);
    expect((failure as Error).message).not.toContain("10.0.0.4");
  });

  /**
   * Retrying here would sit under the delivery claim, which has already decided
   * this attempt is being made once. A second call is one the database never
   * authorised.
   */
  it("makes exactly one provider call and leaves retrying to the claim", async () => {
    const send = resendSend().mockRejectedValue(new Error("503"));

    await senderWith(send)(EMAIL).catch(() => {});

    expect(send).toHaveBeenCalledTimes(1);
  });
});
