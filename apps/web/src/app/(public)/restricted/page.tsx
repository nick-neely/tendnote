import {
  getLatestOwnerDataExportJob,
  ownerHasExportableData,
} from "@tendnote/db/queries/owner-data-export";
import { getLiveSubscription } from "@tendnote/db/queries/stripe-subscriptions";
import { connection } from "next/server";
import { AccountIdentity } from "@/components/account/account-identity";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { OwnerDataExportSection } from "@/components/account/owner-data-export-section";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { CancelSubscriptionButton } from "@/components/billing/cancel-subscription-button";
import { requireRestrictedAccess } from "@/lib/access/pending-access";
import { formatBillingDate } from "@/lib/billing/billing-date";

const smallMuted =
  "text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground";

/**
 * The restricted area (#629): a suspended account keeps exactly export,
 * deletion, and cancelling its subscription. It shows no records, Today, or
 * Eve, and no running credit figure: the rule is stated once here, and the
 * amount arrives when the review ends. Delete and Sign out are always here, so
 * the exit is never blocked. Everything is read from Tendnote's own records.
 */
export default async function RestrictedPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const { user } = await requireRestrictedAccess();

  const [ownsExportableData, subscription] = await Promise.all([
    ownerHasExportableData(user.id),
    getLiveSubscription({ userId: user.id }),
  ]);
  const exportJob = ownsExportableData ? await getLatestOwnerDataExportJob(user.id) : null;

  return (
    <AuthScaffold
      title="Your account is under review"
      subtitle="Access to Tendnote is paused while we review your account. Your data is kept as it is, and nothing has been deleted."
    >
      <div className="flex flex-col gap-5" data-restricted-area>
        <AccountIdentity user={user} />

        {subscription ? (
          <div className="flex flex-col gap-2">
            <p className={smallMuted}>
              Any days you've paid for during the review are credited back when it ends.
            </p>
            {subscription.cancelAt ? (
              <p className={smallMuted} data-cancellation-scheduled>
                Your subscription ends on {formatBillingDate(subscription.cancelAt)}.
              </p>
            ) : (
              <CancelSubscriptionButton />
            )}
          </div>
        ) : null}

        <div className="flex flex-col gap-4 border-t pt-6">
          {ownsExportableData ? <OwnerDataExportSection initialJob={exportJob} /> : null}
          <div className="flex flex-col gap-1">
            <SignOutButton className="w-full" />
            <DeleteAccountButton email={user.email} />
          </div>
        </div>
      </div>
    </AuthScaffold>
  );
}
