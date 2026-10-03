import { readGuestStanding } from "@tendnote/db/queries/households";
import {
  getLatestOwnerDataExportJob,
  ownerHasExportableData,
} from "@tendnote/db/queries/owner-data-export";
import { getStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import { connection } from "next/server";
import { AccountIdentity } from "@/components/account/account-identity";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { OwnerDataExportSection } from "@/components/account/owner-data-export-section";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SubscribeForm } from "@/components/billing/subscribe-form";
import { ClockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { requirePendingAccess } from "@/lib/access/pending-access";
import { pendingAreaView } from "@/lib/access/pending-area";
import { isCheckoutOpen } from "@/lib/billing/checkout-availability";

/** Checkout state, owned data, and any past guest membership, read only from Tendnote's own records. */
async function readPendingAreaFacts(user: { id: string; email: string }) {
  const [checkoutOpen, startedCheckout, ownsExportableData, guestStanding] = await Promise.all([
    isCheckoutOpen(user),
    getStripeCustomerId({ userId: user.id }).then(Boolean),
    ownerHasExportableData(user.id),
    readGuestStanding({ userId: user.id }),
  ]);
  const exportJob = ownsExportableData ? await getLatestOwnerDataExportJob(user.id) : null;
  return {
    facts: { checkoutOpen, startedCheckout, ownsExportableData, guestStanding },
    exportJob,
  };
}

/**
 * The pending area (#607): the one home for every signed-in, not-admitted
 * account. One line of what happened, the signed-in identity, and actions by
 * what the account owns. Delete and Sign out are always here, so the exit is
 * never blocked.
 */
export default async function PendingPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const access = await requirePendingAccess();

  const { user } = access;
  const { facts, exportJob } = await readPendingAreaFacts(user);
  const view = pendingAreaView(facts);

  return (
    <AuthScaffold title={view.title} subtitle={view.line}>
      <div className="flex flex-col gap-5" data-pending-state={view.state}>
        <AccountIdentity user={user} />

        {view.subscribe ? <SubscribeForm /> : null}

        {view.state === "awaiting_access" ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2.5">
            <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              Access status
            </span>
            <Badge variant="secondary">
              <ClockIcon aria-hidden data-icon="inline-start" />
              Pending review
            </Badge>
          </div>
        ) : null}

        <div className="flex flex-col gap-4 border-t pt-6">
          {view.exportData ? <OwnerDataExportSection initialJob={exportJob} /> : null}
          <div className="flex flex-col gap-1">
            <SignOutButton className="w-full" />
            <DeleteAccountButton email={user.email} />
          </div>
        </div>
      </div>
    </AuthScaffold>
  );
}
