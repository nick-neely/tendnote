import "server-only";

import { resolveBetterAuthBaseUrl } from "@tendnote/auth";

/**
 * The canonical acceptance URL for one invitation.
 *
 * Built from the deployment's configured origin, never from an inbound `Host`
 * header: a forged host would otherwise mint a working Tendnote capability link
 * pointing at somebody else's server (OWASP Forgot Password Cheat Sheet, URL
 * tokens). That origin is already required to be HTTPS in production.
 */
export function householdInvitationUrl(secret: string): string {
  return new URL(`/join/${encodeURIComponent(secret)}`, resolveBetterAuthBaseUrl()).toString();
}

export type HouseholdInvitationMessage = {
  /** The durable attempt id. Doubles as the provider idempotency key. */
  deliveryId: string;
  to: string;
  householdName: string;
  inviterName: string | null;
  acceptUrl: string;
  expiresAt: Date;
};

export type HouseholdInvitationTransport = (
  message: HouseholdInvitationMessage,
) => Promise<{ providerMessageId?: string | null }>;

/** Raised when the deployment has no way to send the message it was asked to send. */
export class HouseholdInvitationTransportUnavailableError extends Error {
  override name = "HouseholdInvitationTransportUnavailableError";
}

function householdInvitationSubject(householdName: string): string {
  return `You're invited to ${householdName} on Tendnote`;
}

/**
 * The subject and plain-text body, written once here so the operator transport
 * and any later provider adapter send the same words. Deliberately short: this
 * is a capability hand-off, not a marketing email.
 */
export function householdInvitationMessage(message: HouseholdInvitationMessage): {
  subject: string;
  body: string;
} {
  return {
    subject: householdInvitationSubject(message.householdName),
    body: householdInvitationBody(message),
  };
}

function householdInvitationBody(message: HouseholdInvitationMessage): string {
  const from = message.inviterName ? `${message.inviterName} invited you` : "You've been invited";
  return [
    `${from} to join ${message.householdName} on Tendnote.`,
    "",
    "A household is a small shared layer for the people you live with. Nothing you write in Tendnote is shared until you choose to share it.",
    "",
    `Join here: ${message.acceptUrl}`,
    "",
    `This link works until ${message.expiresAt.toUTCString()}, and only for this email address.`,
    "If you weren't expecting this, you can ignore it — nothing happens unless you accept.",
  ].join("\n");
}

/**
 * The transport used while Tendnote has no transactional email provider.
 *
 * The repository already hands password-reset links to an operator this way, and
 * this mirrors it rather than inventing a second private-beta convention. What
 * it does *not* do is run in production: writing a live capability URL into a
 * hosted log would put a working household invitation somewhere the recipient's
 * mailbox is not. In production this refuses, the attempt is recorded `failed`,
 * and the Owner is told plainly that Tendnote could not hand the invitation to
 * email yet.
 *
 * A provider adapter replaces this function and nothing else: everything around
 * it — the durable attempt, the claim, the idempotency key, the failure class —
 * is already provider-neutral.
 */
export const operatorLogInvitationTransport: HouseholdInvitationTransport = async (message) => {
  if (process.env.NODE_ENV === "production") {
    throw new HouseholdInvitationTransportUnavailableError(
      "No transactional email provider is configured for household invitations.",
    );
  }

  const { subject, body } = householdInvitationMessage(message);
  console.info(
    `[tendnote] Household invitation for ${message.to} (attempt ${message.deliveryId})\n${subject}\n\n${body}`,
  );
  return { providerMessageId: null };
};

/**
 * The one place the rest of the app asks for a transport. It is a function
 * rather than a constant so selecting a provider is a change here and nowhere
 * else.
 */
export function getHouseholdInvitationTransport(): HouseholdInvitationTransport {
  return operatorLogInvitationTransport;
}
