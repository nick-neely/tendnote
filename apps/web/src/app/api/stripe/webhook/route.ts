import { grantAccess } from "@tendnote/db/queries/access-profiles";
import { findUserIdByStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import { anchorUsagePeriod } from "@tendnote/db/queries/usage-bounds";
import { parseAdmissionPolicy } from "@tendnote/domain";
import { createStripeWebhookHandler } from "@/lib/billing/stripe-webhook";

export async function POST(request: Request) {
  const handleStripeWebhook = createStripeWebhookHandler({
    policy: parseAdmissionPolicy(),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    findAccountByStripeCustomer: (stripeCustomerId) =>
      findUserIdByStripeCustomerId({ stripeCustomerId }),
    grantPaidAccess: (userId) => grantAccess({ userId, source: "paid_access" }),
    anchorUsagePeriod: (userId, startedAt) => anchorUsagePeriod({ userId, startedAt }),
  });
  return handleStripeWebhook(request);
}
