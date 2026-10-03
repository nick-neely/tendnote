import "server-only";

import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import { selectTransactionalSender } from "@/lib/email/select-sender";
import { renderAccountEmail } from "@/lib/email/templates/account-email";
import { requireSupportEmail } from "@/lib/email/transactional";

/**
 * The content-free "you're in" email the confirming page promises after a
 * minute (#607). Keyed on the first paid invoice, so a redelivery inside the
 * provider's 24-hour idempotency window collapses into one message; the
 * completed-email fence (#620) makes it exact-once beyond that.
 */
export async function sendAdmittedEmail(input: { to: string; invoiceId: string }): Promise<void> {
  const content = await renderAccountEmail({
    purpose: "admitted",
    actionUrl: new URL("/", resolveBetterAuthBaseUrl()).toString(),
    supportEmail: requireSupportEmail(),
  });

  await selectTransactionalSender()({
    ...content,
    to: input.to,
    idempotencyKey: `admitted:${input.invoiceId}`,
  });
}
