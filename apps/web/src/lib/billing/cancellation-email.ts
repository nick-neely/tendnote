import "server-only";

import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import { selectTransactionalSender } from "@/lib/email/select-sender";
import { renderAccountEmail } from "@/lib/email/templates/account-email";
import { requireSupportEmail } from "@/lib/email/transactional";

/**
 * The content-free confirmation of a cancellation scheduled in the portal
 * (#609). Keyed on the subscription and the date it ends, so redeliveries of
 * one cancellation inside the provider's 24-hour idempotency window collapse
 * into one message; the completed-email fence (#620) makes it exact-once
 * beyond that.
 */
export async function sendCancellationEmail(input: {
  to: string;
  stripeSubscriptionId: string;
  endsAt: Date;
}): Promise<void> {
  const content = await renderAccountEmail({
    purpose: "cancellation",
    actionUrl: new URL("/account", resolveBetterAuthBaseUrl()).toString(),
    supportEmail: requireSupportEmail(),
  });

  await selectTransactionalSender()({
    ...content,
    to: input.to,
    idempotencyKey: `cancellation:${input.stripeSubscriptionId}:${input.endsAt.getTime()}`,
  });
}
