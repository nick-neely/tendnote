import {
  getLatestOwnerDataExportJob,
  ownerHasExportableData,
} from "@tendnote/db/queries/owner-data-export";
import { connection } from "next/server";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { OwnerDataExportSection } from "@/components/account/owner-data-export-section";
import { SignedInIdentity } from "@/components/account/signed-in-identity";
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
 */
export default async function LapsedPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const { user, retentionDeadline } = await requireLapsedAccess();

  const [checkoutOpen, ownsExportableData] = await Promise.all([
    isCheckoutOpen(user),
    ownerHasExportableData(user.id),
  ]);
  const exportJob = ownsExportableData ? await getLatestOwnerDataExportJob(user.id) : null;

  return (
    <AuthScaffold
      title="Your subscription has ended"
      subtitle={`Your data is kept until ${formatBillingDate(retentionDeadline)}, then deleted. Resubscribe before then and everything is where you left it.`}
    >
      <div className="flex flex-col gap-5" data-lapsed-area>
        <SignedInIdentity user={user} />

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
