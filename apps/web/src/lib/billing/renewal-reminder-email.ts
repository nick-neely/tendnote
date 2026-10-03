import "server-only";

import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import { selectTransactionalSender } from "@/lib/email/select-sender";
import { renderAccountEmail } from "@/lib/email/templates/account-email";
import { requireSupportEmail } from "@/lib/email/transactional";

/**
 * The content-free reminder before an annual renewal (#611). Keyed on the
 * subscription and the renewal it announces, so redeliveries of one upcoming
 * renewal inside the provider's 24-hour idempotency window collapse into one
 * message, and next year's renewal gets its own; the completed-email fence
 * (#620) makes it exact-once beyond that.
 */
export async function sendRenewalReminderEmail(input: {
  to: string;
  stripeSubscriptionId: string;
  renewsAt: Date;
}): Promise<void> {
  const content = await renderAccountEmail({
    purpose: "renewal-reminder",
    actionUrl: new URL("/account", resolveBetterAuthBaseUrl()).toString(),
    supportEmail: requireSupportEmail(),
  });

  await selectTransactionalSender()({
    ...content,
    to: input.to,
    idempotencyKey: `renewal-reminder:${input.stripeSubscriptionId}:${input.renewsAt.getTime()}`,
  });
}
