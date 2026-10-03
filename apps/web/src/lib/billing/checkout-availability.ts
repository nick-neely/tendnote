import "server-only";

import { vercelAdapter } from "@flags-sdk/vercel";
import { flag } from "flags/next";
import type { PrivateBetaEntities } from "@/lib/access/private-beta-flag";
import { readHostedStripeBillingConfig } from "./checkout";

/**
 * Hides Checkout until Stage 2 of the launch. The webhook receiver is not behind
 * it, because the live endpoint is registered and verified before Checkout opens.
 */
export const checkoutFlag = flag<boolean, PrivateBetaEntities>({
  key: "checkout",
  description: "Opens Stripe Checkout from the pending area (Phase 9b, hosted only).",
  adapter: vercelAdapter(),
  defaultValue: false,
  options: [
    { value: false, label: "Hidden" },
    { value: true, label: "Open" },
  ],
});

/**
 * Whether this signed-in account may open Checkout: hosted admission mode,
 * Stripe configured, and the Checkout flag on for them. A flag outage hides
 * Checkout rather than failing the page.
 */
export async function isCheckoutOpen(user: { id: string; email: string }): Promise<boolean> {
  if (!readHostedStripeBillingConfig()) return false;
  try {
    return await checkoutFlag.run({ identify: { user: { id: user.id, email: user.email } } });
  } catch {
    return false;
  }
}
