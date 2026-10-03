"use server";

import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import { getStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import { parseAdmissionPolicy } from "@tendnote/domain";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { openBillingPortal } from "@/lib/billing/billing-portal";
import { readStripeBillingConfig } from "@/lib/billing/checkout";

/**
 * Manage billing (#609): send an admitted, paying account to the Stripe portal
 * to update its card, cancel at period end or reverse that, or switch its
 * interval. A Lapsed account resubscribes through Checkout instead.
 */
export async function openBillingPortalAction(): Promise<void> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const config = readStripeBillingConfig();
  if (parseAdmissionPolicy().mode !== "hosted" || !config) {
    throw new Error("Billing is not available right now.");
  }

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
