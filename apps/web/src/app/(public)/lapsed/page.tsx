import { isAccountHeld } from "@tendnote/db/queries/legal-holds";
import {
  getLatestOwnerDataExportJob,
  ownerHasExportableData,
} from "@tendnote/db/queries/owner-data-export";
import { connection } from "next/server";
import { AccountIdentity } from "@/components/account/account-identity";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { OwnerDataExportSection } from "@/components/account/owner-data-export-section";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SubscribeForm } from "@/components/billing/subscribe-form";
import { requireLapsedAccess } from "@/lib/access/pending-access";
import { formatBillingDate } from "@/lib/billing/billing-date";
import { isCheckoutOpen } from "@/lib/billing/checkout-availability";

/**
 * The Lapsed area (#609): an account whose Paid Access ended keeps exactly
 * resubscribe, export, and delete, with the retention deadline set once on
 * entering Lapsed. It shows no records, Today, or Eve: the account is not
 * admitted, so nothing here reads its content beyond whether there is any to
 * export. Delete and Sign out are always here, so the exit is never blocked.
 * While a Legal Hold covers the account (#632) its deletion is paused, so no
 * date is promised; the hold itself is not named.
 */
export default async function LapsedPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const { user, retentionDeadline } = await requireLapsedAccess();

  const [checkoutOpen, ownsExportableData, held] = await Promise.all([
    isCheckoutOpen(user),
    ownerHasExportableData(user.id),
    isAccountHeld({ userId: user.id }),
  ]);
  const exportJob = ownsExportableData ? await getLatestOwnerDataExportJob(user.id) : null;

  return (
    <AuthScaffold
      title="Your subscription has ended"
      subtitle={
        held
          ? "Your data is kept as it is, and nothing has been deleted. Resubscribe and everything is where you left it."
          : `Your data is kept until ${formatBillingDate(retentionDeadline)}, then deleted. Resubscribe before then and everything is where you left it.`
      }
    >
      <div className="flex flex-col gap-5" data-lapsed-area>
        <AccountIdentity user={user} />

        {checkoutOpen ? <SubscribeForm /> : null}

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
