import type { AccessProfile } from "@tendnote/domain";
import type { FirstPaidInvoice } from "./first-paid-invoice";
import { isSubscriptionRevoked, type RevocationRecords } from "./paid-access-revocation";
import {
  projectSubscription,
  type SubscriptionProjectionDependencies,
  type SubscriptionSnapshot,
} from "./subscription-projection";

type ProfileStanding = Pick<AccessProfile, "status" | "source">;

export type PaidAccessAdmissionDependencies = {
  /**
   * Stripe's current copy of a subscription. Projection reads that rather than
   * an event's own copy, so the order events arrive in cannot matter.
   */
  retrieveSubscription: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  /** Where subscription state lands on the account (#609). */
  subscriptions: SubscriptionProjectionDependencies;
  /** The refunds and disputes that revoke a subscription's Paid Access (#617). */
  revocations: Pick<RevocationRecords, "listSubscriptionRevocationBlocks">;
  /** Grant the account Paid Access from this subscription. Must be idempotent. */
  grantPaidAccess: (userId: string, stripeSubscriptionId: string) => Promise<ProfileStanding>;
  /** Anchor the account's Usage Period to its subscription's start. Must be idempotent. */
  anchorUsagePeriod: (userId: string, startedAt: Date) => Promise<unknown>;
};

/**
 * Admit an account on its subscription's first paid invoice: the one way Paid
 * Access is granted, for the webhook and the reconciliation job (#608) alike.
 * The subscription is projected from Stripe's current copy first, and one that
 * has ended admits nobody, so re-projecting a first invoice that is still paid
 * in Stripe never brings back an account its end made Lapsed (#609). Nor does
 * one whose Paid Access a refund or an unexcepted dispute revoked (#617). An
 * end already on record is terminal, so it is refused without asking Stripe.
 *
 * Returns the account's standing after the grant, or `null` when the
 * subscription has ended or is revoked. Every write is idempotent.
 */
export async function admitFromFirstPaidInvoice(
  deps: PaidAccessAdmissionDependencies,
  userId: string,
  paid: FirstPaidInvoice,
): Promise<ProfileStanding | null> {
  const recorded = await deps.subscriptions.getSubscription({
    stripeSubscriptionId: paid.stripeSubscriptionId,
  });
  if (recorded?.endedAt) return null;

  const subscription = await deps.retrieveSubscription(paid.stripeSubscriptionId);
  await projectSubscription(deps.subscriptions, userId, subscription);
  if (subscription.endedAt) return null;
  if (await isSubscriptionRevoked(deps.revocations, paid.stripeSubscriptionId)) return null;

  const standing = await deps.grantPaidAccess(userId, paid.stripeSubscriptionId);
  // After the grant, which is what guarantees the Access Profile exists.
  await deps.anchorUsagePeriod(userId, paid.startedAt);
  return standing;
}
