import {
  getLatestOwnerDataExportJob,
  ownerHasExportableData,
} from "@tendnote/db/queries/owner-data-export";
import { getStripeCustomerId } from "@tendnote/db/queries/stripe-customers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { OwnerDataExportSection } from "@/components/account/owner-data-export-section";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SubscribeForm } from "@/components/billing/subscribe-form";
import { ClockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { getCurrentAccess } from "@/lib/access/current-access";
import { pendingAreaView } from "@/lib/access/pending-area";
import { isCheckoutOpen } from "@/lib/billing/checkout-availability";

/** Checkout state and owned data, read only from Tendnote's own records. */
async function readPendingAreaFacts(user: { id: string; email: string }) {
  const [checkoutOpen, ownsExportableData] = await Promise.all([
    isCheckoutOpen(user),
    ownerHasExportableData(user.id),
  ]);
  const [startedCheckout, exportJob] = await Promise.all([
    checkoutOpen ? getStripeCustomerId({ userId: user.id }).then(Boolean) : false,
    ownsExportableData ? getLatestOwnerDataExportJob(user.id) : null,
  ]);
  return { facts: { checkoutOpen, startedCheckout, ownsExportableData }, exportJob };
}

/**
 * The pending area (#607): the one home for every signed-in, not-admitted
 * account. One line of what happened, the signed-in identity, and actions by
 * what the account owns. Delete and Sign out are always here, so the exit is
 * never blocked.
 */
export default async function PendingPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const access = await getCurrentAccess();

  if (access.state === "unauthenticated") {
    redirect("/sign-in");
  }

  if (access.state === "admitted") {
    redirect("/");
  }

  const { user } = access;
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase() || "?";
  const { facts, exportJob } = await readPendingAreaFacts(user);
  const view = pendingAreaView(facts);

  return (
    <AuthScaffold title={view.title} subtitle={view.line}>
      <div className="flex flex-col gap-5" data-pending-state={view.state}>
        {/* Identity, so the visitor can confirm which account is signed in. */}
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-[length:var(--text-small)] font-medium text-secondary-foreground"
          >
            {initial}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
              {user.name || user.email}
            </span>
            {user.name ? (
              <span className="truncate text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
                {user.email}
              </span>
            ) : null}
          </div>
        </div>

        {view.subscribe ? (
          <SubscribeForm />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2.5">
            <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              Access status
            </span>
            <Badge variant="secondary">
              <ClockIcon aria-hidden data-icon="inline-start" />
              Pending review
            </Badge>
          </div>
        )}

        <div className="flex flex-col gap-4 border-t pt-5">
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
