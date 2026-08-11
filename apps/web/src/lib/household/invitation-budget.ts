import "server-only";

import { createHmac } from "node:crypto";
import { resolveBetterAuthSecret } from "@tendnote/auth";
import { normalizeInvitationEmail } from "@tendnote/domain/household-invitations";
import { headers } from "next/headers";
import { enforceProductBudget } from "@/lib/rate-limit/guards";

/**
 * A stable, non-reversible handle for one recipient address.
 *
 * The limiter needs to recognise "this address again" without the address
 * itself: an invitation budget must not turn Redis into a second copy of who is
 * being invited where. Keyed off the deployment's Better Auth secret so the
 * handles are useless anywhere else, and truncated because a limiter key needs
 * collision resistance, not a full digest.
 */
function recipientBudgetKey(email: string): string {
  return createHmac("sha256", resolveBetterAuthSecret())
    .update(normalizeInvitationEmail(email))
    .digest("hex")
    .slice(0, 32);
}

/**
 * The request's trusted origin fingerprint, hashed the same way.
 *
 * Only `x-forwarded-for`'s **first** hop is read, and only the leftmost entry a
 * client cannot append to after the platform proxy rewrites it. A request that
 * arrives without one is charged to a single shared `unattributed` bucket rather
 * than being waved through: an unidentifiable caller should share one budget,
 * not escape budgeting.
 */
async function sourceBudgetKey(): Promise<string> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const source = forwarded || requestHeaders.get("x-real-ip")?.trim();
  if (!source) return "unattributed";

  return createHmac("sha256", resolveBetterAuthSecret()).update(source).digest("hex").slice(0, 32);
}

/**
 * Charges every invitation budget that can be known before an invitation exists.
 *
 * Four of the five keys from the delivery-and-abuse research, each bounding a
 * different abuse and each with its own limit: the inviter (one account cannot
 * spray invitations), the household (co-owners cannot outpace it together), the
 * source fingerprint (fresh accounts do not reset the budget), and the
 * deployment-wide delivery ceiling (no single household can burn the sending
 * reputation everyone shares).
 *
 * `email` — the fifth key — is optional only because a resend learns its
 * recipient from the invitation it is rotating; that caller charges
 * {@link chargeHouseholdInvitationRecipientBudget} separately, still before the
 * message is handed over.
 *
 * They are charged, not merely checked, and the limiter fails closed when its
 * store is unavailable. Every one raises the same message, so a refusal never
 * discloses which key fired — that difference would itself be a signal about the
 * recipient.
 */
export async function chargeHouseholdInvitationBudget(input: {
  ownerUserId: string;
  householdId: string;
  email?: string;
}): Promise<void> {
  await enforceProductBudget({
    costCategory: "household-invitation-inviter",
    subject: input.ownerUserId,
  });
  await enforceProductBudget({
    costCategory: "household-invitation-household",
    subject: input.householdId,
  });
  await enforceProductBudget({
    costCategory: "household-invitation-source",
    subject: await sourceBudgetKey(),
  });
  // One shared subject: this budget is the deployment's, not any caller's.
  await enforceProductBudget({
    costCategory: "household-invitation-delivery",
    subject: "deployment",
  });
  if (input.email !== undefined) {
    await chargeHouseholdInvitationRecipientBudget(input.email);
  }
}

export async function chargeHouseholdInvitationRecipientBudget(email: string): Promise<void> {
  await enforceProductBudget({
    costCategory: "household-invitation-recipient",
    subject: recipientBudgetKey(email),
  });
}
