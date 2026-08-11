import { HOUSEHOLD_SUPPORT_EMAIL } from "@tendnote/domain/household-governance";

/** One rendered message, independent of who is going to carry it. */
export type TransactionalEmailContent = {
  subject: string;
  html: string;
  /** The plain-text alternative. Always sent, never optional. */
  text: string;
};

export type TransactionalEmail = TransactionalEmailContent & {
  to: string;
  /**
   * The durable attempt id, reused verbatim on an ambiguous retry so a network
   * timeout cannot become two messages in someone's inbox. Tendnote's own
   * database claim is the exact-once authority; this is the provider's second
   * opinion, not a substitute for it.
   */
  idempotencyKey: string;
};

/** What a transport is: one function, one message, one provider id or none. */
export type TransactionalSender = (
  email: TransactionalEmail,
) => Promise<{ providerMessageId: string | null }>;

/**
 * Raised when the deployment has no way to send the message it was asked to
 * send. The name is what `dispatchHouseholdInvitationDelivery` records as the
 * attempt's failure class, so it has to read as a cause on its own.
 */
export class EmailTransportUnavailableError extends Error {
  override name = "EmailTransportUnavailableError";
}

/**
 * Who Tendnote's transactional mail is from, and where a reply lands.
 *
 * `From` is on a dedicated `mail.` subdomain so transactional reputation is
 * earned and lost separately from anything else the apex domain ever sends, and
 * it is a real named sender rather than `noreply@` - people do reply to a
 * message about being invited into someone's home, and a mailbox that swallows
 * that is a rudeness with a deliverability cost. `Reply-To` is the monitored
 * support inbox, which is the same address every household surface already
 * shows, so the two cannot drift.
 *
 * Both are overridable by environment for a preview deployment that must not
 * send as the production domain.
 */
export type TransactionalSenderIdentity = { from: string; replyTo: string };

export const DEFAULT_EMAIL_FROM = "Tendnote <notifications@mail.stacklet.app>";

/**
 * Exactly the variables this module reads, named rather than taking the whole
 * environment: the type is then the list of what a deployment can set, and a
 * test supplies a case rather than a copy of `process.env`.
 */
export type EmailEnvironment = {
  NODE_ENV?: string;
  RESEND_API_KEY?: string;
  TENDNOTE_EMAIL_FROM?: string;
  TENDNOTE_EMAIL_REPLY_TO?: string;
};

export function resolveSenderIdentity(env: EmailEnvironment): TransactionalSenderIdentity {
  return {
    from: env.TENDNOTE_EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM,
    replyTo: env.TENDNOTE_EMAIL_REPLY_TO?.trim() || HOUSEHOLD_SUPPORT_EMAIL,
  };
}

/**
 * Which transport this deployment gets, decided from the environment alone.
 *
 * Split out from the transports themselves so the rule is readable and testable
 * without constructing a provider client: everything about "does this deployment
 * send real email" is these fifteen lines.
 */
export type TransactionalTransportChoice =
  | { kind: "operator-log" }
  | { kind: "resend"; apiKey: string }
  | { kind: "unavailable"; reason: string };

export function decideTransactionalTransport(env: EmailEnvironment): TransactionalTransportChoice {
  // The test runner never sends, whatever is in the ambient environment. A
  // developer with a live key in their shell must not discover it by mailing a
  // fixture's address from a unit test.
  if (env.NODE_ENV === "test") return { kind: "operator-log" };

  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) return { kind: "resend", apiKey };

  // Production with no key is a misconfiguration, not a mode. It fails loudly
  // and by name rather than falling back to a transport that would write a live
  // capability URL into a hosted log.
  if (env.NODE_ENV === "production") {
    return {
      kind: "unavailable",
      reason:
        "RESEND_API_KEY is not set, so Tendnote cannot send transactional email. Add the key from the Resend dashboard to this deployment's environment (see docs/email-setup.md).",
    };
  }

  return { kind: "operator-log" };
}

/**
 * The transport used while a deployment has no provider.
 *
 * Local development wants to click the link, not read an inbox, so the message
 * goes to the server log the same way password-reset links already do. It is
 * only ever selected outside production; `decideTransactionalTransport` is what
 * guarantees that, and a hosted log never receives a working capability URL.
 */
export const operatorLogSender: TransactionalSender = async (email) => {
  console.info(
    `[tendnote] Transactional email for ${email.to} (attempt ${email.idempotencyKey})\n${email.subject}\n\n${email.text}`,
  );
  return { providerMessageId: null };
};

/** The transport that exists only to say why there isn't one. */
export function unavailableSender(reason: string): TransactionalSender {
  return async () => {
    throw new EmailTransportUnavailableError(reason);
  };
}
