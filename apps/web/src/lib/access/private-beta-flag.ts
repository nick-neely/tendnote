import "server-only";

import { vercelAdapter } from "@flags-sdk/vercel";
import { checkAccess, grantAccess } from "@tendnote/db/queries/access-profiles";
import { dedupe, flag } from "flags/next";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth/server";
import {
  type BetaFlagEntity,
  createPrivateBetaAccessResolver,
  type PrivateBetaFlagEvaluator,
} from "./resolve-access";

export const PRIVATE_BETA_FLAG_KEY = "private-beta-access";

/** Vercel Flags entities wrapper around the signed-in user being evaluated. */
export type PrivateBetaEntities = {
  user?: { id: string; email?: string };
};

// Derive the entity from the trusted Better Auth session so the browser cannot
// influence flag targeting. Deduped so repeated evaluation in one request is cheap.
const identify = dedupe(async (): Promise<PrivateBetaEntities> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const user = session?.user;

  return user ? { user: { id: user.id, email: user.email } } : {};
});

export const privateBetaAccessFlag = flag<boolean, PrivateBetaEntities>({
  key: PRIVATE_BETA_FLAG_KEY,
  description: "Private Beta Access gate for Tendnote (Phase 2A).",
  adapter: vercelAdapter(),
  defaultValue: false,
  options: [
    { value: false, label: "Denied" },
    { value: true, label: "Granted" },
  ],
  identify,
});

/**
 * Production evaluator: runs the Vercel Flags flag with the trusted entity passed
 * explicitly, so evaluation uses the server-resolved user id and email rather
 * than re-reading request cookies.
 */
export const evaluatePrivateBetaFlag: PrivateBetaFlagEvaluator = async (entity: BetaFlagEntity) => {
  return privateBetaAccessFlag.run({
    identify: { user: { id: entity.userId, email: entity.email ?? undefined } },
  });
};

/** The single, app-wide Private Beta Access resolver used by pages, server
 * actions, and Eve ingress. */
export const privateBetaAccess = createPrivateBetaAccessResolver({
  accessProfiles: { checkAccess, grantAccess },
  evaluateFlag: evaluatePrivateBetaFlag,
});
