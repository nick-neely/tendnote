import "server-only";

import {
  getAccessProfile,
  grantAccess,
  lapsePaidAccess,
} from "@tendnote/db/queries/access-profiles";
import { getAuthUserEmail } from "@tendnote/db/queries/auth-users";
import { findUserIdByStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import {
  getStripeSubscription,
  recordStripeSubscription,
} from "@tendnote/db/queries/stripe-subscriptions";
import { anchorUsagePeriod } from "@tendnote/db/queries/usage-bounds";
import Stripe from "stripe";
import { sendAdmittedEmail } from "./admitted-email";
import { sendCancellationEmail } from "./cancellation-email";
import { readStripeBillingConfig } from "./checkout";
import { subscriptionSnapshot } from "./subscription-projection";

/**
 * The production writes behind the Paid Access projection, shared by the
 * webhook receiver and the reconciliation job so the two cannot drift apart.
 */
export const paidAccessProjection = {
  findAccountByStripeCustomer: (stripeCustomerId: string) =>
    findUserIdByStripeCustomerId({ stripeCustomerId }),
  readAccessProfile: (userId: string) => getAccessProfile({ userId }),
  grantPaidAccess: (userId: string, stripeSubscriptionId: string) =>
    grantAccess({ userId, source: "paid_access", stripeSubscriptionId }),
  anchorUsagePeriod: (userId: string, startedAt: Date) => anchorUsagePeriod({ userId, startedAt }),
  announceAdmission: async ({ userId, invoiceId }: { userId: string; invoiceId: string }) => {
    // An account deleted since it paid has nobody left to tell.
    const to = await getAuthUserEmail({ userId });
    if (to) await sendAdmittedEmail({ to, invoiceId });
  },
  retrieveSubscription: async (stripeSubscriptionId: string) => {
    const config = readStripeBillingConfig();
    // Unconfigured, the work fails and is retried once Stripe is configured.
    if (!config) throw new Error("Stripe is not configured.");
    const stripe = new Stripe(config.secretKey);
    return subscriptionSnapshot(await stripe.subscriptions.retrieve(stripeSubscriptionId));
  },
  subscriptions: {
    getSubscription: getStripeSubscription,
    recordSubscription: recordStripeSubscription,
    lapsePaidAccess,
    confirmCancellation: async (input: {
      userId: string;
      stripeSubscriptionId: string;
      endsAt: Date;
    }) => {
      const to = await getAuthUserEmail({ userId: input.userId });
      if (to) {
        await sendCancellationEmail({
          to,
          stripeSubscriptionId: input.stripeSubscriptionId,
          endsAt: input.endsAt,
        });
      }
    },
  },
};
