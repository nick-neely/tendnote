import { parseAdmissionPolicy } from "@tendnote/domain";
import { paidAccessProjection } from "@/lib/billing/paid-access-projection";
import { createStripeWebhookHandler } from "@/lib/billing/stripe-webhook";

export async function POST(request: Request) {
  const handleStripeWebhook = createStripeWebhookHandler({
    ...paidAccessProjection,
    policy: parseAdmissionPolicy(),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  return handleStripeWebhook(request);
}
