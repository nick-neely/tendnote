import { getHouseholdOverviewForUser } from "@tendnote/db/queries/households";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountIdentity } from "@/components/account/account-identity";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SubscribeForm } from "@/components/billing/subscribe-form";
import { EyeIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { requireGuestAccess } from "@/lib/access/pending-access";
import { isCheckoutOpen } from "@/lib/billing/checkout-availability";

export const metadata = { title: "Guest", robots: { index: false, follow: false } };

/**
 * Where a live Household Guest lands (#635): its own chrome, never the app
 * shell. It names the household, says the view is read-only and the records
 * are its members', and offers subscribing as the one way into the rest of
 * Tendnote. No paid feature is shown, locked or otherwise.
 */
export default async function GuestPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const { user } = await requireGuestAccess();

  const [household, checkoutOpen] = await Promise.all([
    getHouseholdOverviewForUser({ userId: user.id }),
    isCheckoutOpen(user),
  ]);
  // The membership ended between the access check and this read.
  if (!household) redirect("/pending");

  return (
    <AuthScaffold
      title={household.name}
      subtitle="You're a guest in this household. The records here belong to its members, and you can read what they share with you."
    >
      <div className="flex flex-col gap-5">
        <AccountIdentity user={user} />

        <div className="flex items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2.5">
          <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            Your access
          </span>
          <Badge variant="secondary">
            <EyeIcon aria-hidden data-icon="inline-start" />
            Read-only
          </Badge>
        </div>

        {checkoutOpen ? (
          <div className="flex flex-col gap-3">
            <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
              Subscribe to use the rest of Tendnote. You keep your place in the household.
            </p>
            <SubscribeForm />
          </div>
        ) : null}

        <div className="flex flex-col gap-1 border-t pt-6">
          <SignOutButton className="w-full" />
          <DeleteAccountButton email={user.email} />
        </div>
      </div>
    </AuthScaffold>
  );
}
