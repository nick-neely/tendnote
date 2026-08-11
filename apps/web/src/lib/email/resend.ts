import { Resend } from "resend";
import type {
  TransactionalEmail,
  TransactionalSender,
  TransactionalSenderIdentity,
} from "./transactional";

/**
 * A failure the provider reported or the network caused. The name is what the
 * delivery attempt records as its failure class, so it stays a class and never
 * carries what Resend knows about the recipient - a bounce history is the
 * provider's, and an Owner is entitled to their own invitation's state and to
 * nothing else about the person they invited.
 */
export class ResendSendError extends Error {
  override name = "ResendSendError";
}

/**
 * The one Resend call Tendnote makes, narrowed to the fields it actually sends.
 *
 * Written as the seam rather than reusing the SDK's own union so a test can
 * stand in for the client with an ordinary function, and so the surface Tendnote
 * depends on is legible at a glance: six fields and a key. Typing the live
 * client as this on the way in is what checks the narrowing still holds after an
 * SDK upgrade, rather than discovering it at runtime.
 */
export type ResendEmails = {
  send(
    payload: {
      from: string;
      to: string;
      replyTo: string;
      subject: string;
      html: string;
      text: string;
    },
    options: { idempotencyKey: string },
  ): Promise<{
    data: { id: string } | null;
    /**
     * Resend's own failure shape. `message` and `statusCode` are named here so
     * it is visible that the adapter reads neither: the message can quote what
     * Resend knows about the recipient, which is not the Owner's to read.
     */
    error: { name: string; message: string; statusCode: number | null } | null;
  }>;
};

/**
 * The Resend adapter. Everything provider-shaped about Tendnote's email lives
 * inside this function and nothing outside it changes if the provider does.
 *
 * ## What it deliberately does not do
 *
 * No retry loop. Retrying inside the adapter would sit under
 * `dispatchHouseholdInvitationDelivery`'s claim, which has already decided this
 * attempt is being made exactly once - a second try in here is a second provider
 * call the database never authorised. A failure is recorded and the durable
 * attempt row is what a later drain re-reads.
 *
 * No open or click tracking. The link in an invitation is a capability, and a
 * click-tracking redirect would hand a working household invitation to a third
 * party's URL shortener. Resend's defaults are left alone; nothing here turns
 * tracking on.
 *
 * No `List-Unsubscribe`. This is a one-off transactional message to an address a
 * person typed, not a list anyone is on, and offering to unsubscribe from a
 * thing that will never send again is noise pretending to be a courtesy.
 */
export function createResendSender(config: {
  apiKey: string;
  identity: TransactionalSenderIdentity;
  /** Injectable so the adapter can be tested without a network or a key. */
  client?: ResendEmails;
}): TransactionalSender {
  const emails: ResendEmails = config.client ?? new Resend(config.apiKey).emails;

  return async (email: TransactionalEmail) => {
    const sent = await send(emails, email, config.identity);

    // Resend returns its failures rather than throwing them, so an unchecked
    // call would report a successful send for a rejected request.
    if (sent.error) {
      throw new ResendSendError(`Resend refused the send: ${sent.error.name}`);
    }
    return { providerMessageId: sent.data?.id ?? null };
  };
}

async function send(
  emails: ResendEmails,
  email: TransactionalEmail,
  identity: TransactionalSenderIdentity,
) {
  try {
    return await emails.send(
      {
        from: identity.from,
        to: email.to,
        replyTo: identity.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
      },
      // Resend deduplicates on this key for 24 hours. Tendnote's own claim is
      // the exact-once authority; this covers the window between a request
      // leaving here and an answer that never arrives.
      { idempotencyKey: email.idempotencyKey },
    );
  } catch (cause) {
    // A network failure throws where a rejected request would have been
    // returned. Both end up as one failure class, with the provider's message
    // kept off the wire.
    throw new ResendSendError("Resend could not be reached.", { cause });
  }
}
