import { grantAccess, lapsePaidAccess } from "@tendnote/db/queries/access-profiles";
import { getAuthUserEmail } from "@tendnote/db/queries/auth-users";
import { findUserIdByStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import {
  getStripeSubscription,
  hasOtherLiveStripeSubscription,
  recordStripeSubscription,
} from "@tendnote/db/queries/stripe-subscriptions";
import { anchorUsagePeriod } from "@tendnote/db/queries/usage-bounds";
import { parseAdmissionPolicy } from "@tendnote/domain";
import Stripe from "stripe";
import { sendAdmittedEmail } from "@/lib/billing/admitted-email";
import { sendCancellationEmail } from "@/lib/billing/cancellation-email";
import { readStripeBillingConfig } from "@/lib/billing/checkout";
import { createStripeWebhookHandler } from "@/lib/billing/stripe-webhook";
import { subscriptionSnapshot } from "@/lib/billing/subscription-projection";

export async function POST(request: Request) {
  const handleStripeWebhook = createStripeWebhookHandler({
    policy: parseAdmissionPolicy(),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    findAccountByStripeCustomer: (stripeCustomerId) =>
      findUserIdByStripeCustomerId({ stripeCustomerId }),
    grantPaidAccess: (userId) => grantAccess({ userId, source: "paid_access" }),
    anchorUsagePeriod: (userId, startedAt) => anchorUsagePeriod({ userId, startedAt }),
    announceAdmission: async ({ userId, invoiceId }) => {
      // An account deleted since it paid has nobody left to tell.
      const to = await getAuthUserEmail({ userId });
      if (to) await sendAdmittedEmail({ to, invoiceId });
    },
    retrieveSubscription: async (stripeSubscriptionId) => {
      const config = readStripeBillingConfig();
      // Unconfigured, the delivery fails and Stripe redelivers once it is.
      if (!config) throw new Error("Stripe is not configured.");
      const stripe = new Stripe(config.secretKey);
      return subscriptionSnapshot(await stripe.subscriptions.retrieve(stripeSubscriptionId));
    },
    subscriptions: {
      getSubscription: getStripeSubscription,
      recordSubscription: recordStripeSubscription,
      hasOtherLiveSubscription: hasOtherLiveStripeSubscription,
      lapsePaidAccess,
      confirmCancellation: async ({ userId, stripeSubscriptionId, endsAt }) => {
        const to = await getAuthUserEmail({ userId });
        if (to) await sendCancellationEmail({ to, stripeSubscriptionId, endsAt });
      },
    },
  });
  return handleStripeWebhook(request);
}
