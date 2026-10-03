import "server-only";

import { getAccessProfile, grantAccess } from "@tendnote/db/queries/access-profiles";
import { getAuthUserEmail } from "@tendnote/db/queries/auth-users";
import { findUserIdByStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import { anchorUsagePeriod } from "@tendnote/db/queries/usage-bounds";
import { sendAdmittedEmail } from "./admitted-email";

/**
 * The production writes behind the Paid Access projection, shared by the
 * webhook receiver and the reconciliation job so the two cannot drift apart.
 */
export const paidAccessProjection = {
  findAccountByStripeCustomer: (stripeCustomerId: string) =>
    findUserIdByStripeCustomerId({ stripeCustomerId }),
  readAccessProfile: (userId: string) => getAccessProfile({ userId }),
  grantPaidAccess: (userId: string) => grantAccess({ userId, source: "paid_access" }),
  anchorUsagePeriod: (userId: string, startedAt: Date) => anchorUsagePeriod({ userId, startedAt }),
  announceAdmission: async ({ userId, invoiceId }: { userId: string; invoiceId: string }) => {
    // An account deleted since it paid has nobody left to tell.
    const to = await getAuthUserEmail({ userId });
    if (to) await sendAdmittedEmail({ to, invoiceId });
  },
};
