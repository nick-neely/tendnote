import "server-only";

import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import { selectTransactionalSender } from "@/lib/email/select-sender";
import { renderAccountEmail } from "@/lib/email/templates/account-email";
import { requireSupportEmail } from "@/lib/email/transactional";

/**
 * The content-free confirmation of a refund that revoked Paid Access (#617).
 * Keyed on the Refund record, so a redelivery inside the provider's 24-hour
 * idempotency window collapses into one message; the record's revocation mark
 * keeps later passes from sending it at all.
 */
export async function sendRefundEmail(input: {
  to: string;
  refundRecordId: string;
}): Promise<void> {
  const content = await renderAccountEmail({
    purpose: "refund",
    actionUrl: new URL("/account", resolveBetterAuthBaseUrl()).toString(),
    supportEmail: requireSupportEmail(),
  });

  await selectTransactionalSender()({
    ...content,
    to: input.to,
    idempotencyKey: `refund:${input.refundRecordId}`,
  });
}
