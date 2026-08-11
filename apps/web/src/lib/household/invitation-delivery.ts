import "server-only";

import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import { createResendSender } from "@/lib/email/resend";
import { renderHouseholdInvitationEmail } from "@/lib/email/templates/household-invitation";
import {
  decideTransactionalTransport,
  operatorLogSender,
  resolveSenderIdentity,
  type TransactionalSender,
  unavailableSender,
} from "@/lib/email/transactional";

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

/**
 * The one place the rest of the app asks for a transport.
 *
 * It is a function rather than a constant so which provider a deployment uses is
 * a change here and nowhere else, and so the environment is read per send rather
 * than at import time - a module-level client would be built during the build,
 * before the deployment's secrets exist.
 *
 * What it composes is deliberately two separable things: the message is rendered
 * from the template, and the rendered message is handed to whichever transport
 * this environment gets. Neither half knows about the other's concerns, which is
 * why swapping Resend for something else touches one file.
 */
export function getHouseholdInvitationTransport(): HouseholdInvitationTransport {
  const send = selectSender();

  return async (message) => {
    const content = await renderHouseholdInvitationEmail({
      householdName: message.householdName,
      inviterName: message.inviterName,
      acceptUrl: message.acceptUrl,
      expiresAt: message.expiresAt,
    });

    return send({ ...content, to: message.to, idempotencyKey: message.deliveryId });
  };
}

function selectSender(): TransactionalSender {
  const choice = decideTransactionalTransport(process.env);

  switch (choice.kind) {
    case "resend":
      return createResendSender({
        apiKey: choice.apiKey,
        identity: resolveSenderIdentity(process.env),
      });
    case "unavailable":
      return unavailableSender(choice.reason);
    default:
      return operatorLogSender;
  }
}
