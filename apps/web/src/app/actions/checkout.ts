"use server";

import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import { getStripeCustomerId, recordStripeCustomer } from "@tendnote/db/queries/stripe-customers";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { REACCEPTANCE_PATH } from "@/lib/access/access-state";
import { getCurrentAccess } from "@/lib/access/current-access";
import {
  openCheckout,
  parseBillingInterval,
  readStripeBillingConfig,
} from "@/lib/billing/checkout";
import { isCheckoutOpen } from "@/lib/billing/checkout-availability";

/**
 * Subscribe from the pending area (#606): send a signed-in, not-yet-admitted
 * account to Stripe Checkout for the chosen interval. An admitted account has
 * nothing to buy and goes home instead.
 */
export async function startCheckoutAction(formData: FormData): Promise<void> {
  const access = await getCurrentAccess();
  if (access.state === "unauthenticated") redirect("/sign-in");
  if (access.state === "reacceptance") redirect(REACCEPTANCE_PATH);
  if (access.state === "admitted") redirect("/");

  const interval = parseBillingInterval(formData.get("interval"));
  const config = readStripeBillingConfig();
  if (!interval || !config || !(await isCheckoutOpen(access.user))) {
    throw new Error("Subscribing is not available right now.");
  }

  const url = await openCheckout(
    {
      stripe: new Stripe(config.secretKey),
      prices: config.prices,
      baseUrl: resolveBetterAuthBaseUrl(),
      getStripeCustomerId,
      recordStripeCustomer,
    },
    { userId: access.user.id, email: access.user.email, interval },
  );
  redirect(url);
}
