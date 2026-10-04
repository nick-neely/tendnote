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
 * The restricted area. A suspended account (#629) keeps exactly export,
 * deletion, and cancelling its subscription; it sees no running credit figure:
 * the rule is stated once here, and the amount arrives when the review ends. A
 * terminated account (#630) keeps export and deletion only, with the retention
 * deadline stored on its termination; its renewal is already stopped, so there
 * is nothing to cancel and no resubscribe. Neither shows records, Today, or
 * Eve. Delete and Sign out are always here, so the exit is never blocked.
 * Everything is read from Tendnote's own records.
 */
export default async function RestrictedPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const { user, restriction } = await requireRestrictedAccess();
  const suspended = restriction.kind === "suspension";

  const [ownsExportableData, subscription] = await Promise.all([
    ownerHasExportableData(user.id),
    suspended ? getLiveSubscription({ userId: user.id }) : null,
  ]);
  const exportJob = ownsExportableData ? await getLatestOwnerDataExportJob(user.id) : null;

  return (
    <AuthScaffold
      title={suspended ? "Your account is under review" : "Your access to Tendnote has ended"}
      subtitle={
        suspended
          ? "Access to Tendnote is paused while we review your account. Your data is kept as it is, and nothing has been deleted."
          : `Your subscription won't renew. Your data is kept until ${formatBillingDate(restriction.retentionDeadline)}, then deleted. Until then you can export it or delete your account.`
      }
    >
      <div className="flex flex-col gap-5" data-restricted-area={restriction.kind}>
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
