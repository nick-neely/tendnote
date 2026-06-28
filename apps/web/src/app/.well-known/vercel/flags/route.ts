import { createFlagsDiscoveryEndpoint, getProviderData } from "flags/next";
import { privateBetaAccessFlag } from "@/lib/access/private-beta-flag";

/**
 * Vercel Flags discovery endpoint for the Flags Explorer. Authorization is
 * handled by `createFlagsDiscoveryEndpoint` against `FLAGS_SECRET`, so the
 * private-beta flag metadata is only exposed to the Vercel Toolbar.
 */
export const GET = createFlagsDiscoveryEndpoint(async () => {
  return getProviderData({ privateBetaAccessFlag });
});
