import { getProviderData } from "@flags-sdk/vercel";
import { createFlagsDiscoveryEndpoint } from "flags/next";
import { privateBetaAccessFlag } from "@/lib/access/private-beta-flag";
import { checkoutFlag } from "@/lib/billing/checkout-availability";

/**
 * Vercel Flags discovery endpoint for the Flags Explorer. Authorization is
 * handled by `createFlagsDiscoveryEndpoint` against `FLAGS_SECRET`, so flag
 * metadata is only exposed to the Vercel Toolbar.
 */
export const GET = createFlagsDiscoveryEndpoint(async () => {
  return getProviderData({ privateBetaAccessFlag, checkoutFlag });
});
