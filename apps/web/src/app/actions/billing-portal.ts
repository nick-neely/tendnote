"use server";

import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import { getStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import { getLiveSubscription } from "@tendnote/db/queries/stripe-subscriptions";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { RESTRICTED_PATH } from "@/lib/access/access-state";
import { getCurrentAccess, requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { openBillingPortal, openSubscriptionCancel } from "@/lib/billing/billing-portal";
import { readHostedStripeBillingConfig } from "@/lib/billing/checkout";

/**
 * Manage billing (#609): send an admitted, paying account to the Stripe portal
 * to update its card, cancel at period end or reverse that, or switch its
 * interval. A Lapsed account resubscribes through Checkout instead.
 */
export async function openBillingPortalAction(): Promise<void> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const config = readHostedStripeBillingConfig();
  if (!config) throw new Error("Billing is not available right now.");

  const url = await openBillingPortal(
    {
      stripe: new Stripe(config.secretKey),
      prices: config.prices,
      baseUrl: resolveBetterAuthBaseUrl(),
      getStripeCustomerId,
    },
    { userId: ownerUserId },
  );
  redirect(url);
}

/**
 * Cancel from the restricted area (#629): a suspended account may cancel its
 * subscription at period end, exactly as it could before the suspension, and
 * nothing else in the portal. The suspension itself never touches Stripe; this
 * is the customer's own request. A terminated account has nothing to cancel:
 * its Termination already stopped the renewal (#630).
 */
export async function openSubscriptionCancelAction(): Promise<void> {
  const access = await getCurrentAccess();
  if (access.state !== "restricted" || access.restriction.kind !== "suspension") {
    throw new Error("There is no subscription to cancel here.");
  }
  const config = readHostedStripeBillingConfig();
  if (!config) throw new Error("Billing is not available right now.");
  const subscription = await getLiveSubscription({ userId: access.user.id });
  if (!subscription || subscription.cancelAt)
    throw new Error("There is no subscription to cancel.");

  const url = await openSubscriptionCancel(
    {
      stripe: new Stripe(config.secretKey),
      prices: config.prices,
      baseUrl: resolveBetterAuthBaseUrl(),
      getStripeCustomerId,
    },
    {
      userId: access.user.id,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      returnPath: RESTRICTED_PATH,
    },
  );
  redirect(url);
}
