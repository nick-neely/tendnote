import { getHouseholdOverviewForUser } from "@tendnote/db/queries/households";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { SubscribeForm } from "@/components/billing/subscribe-form";
import { ArrowLeftIcon } from "@/components/icons";
import { GUEST_PATH } from "@/lib/access/access-state";
import { requireGuestAccess } from "@/lib/access/pending-access";
import { isCheckoutOpen } from "@/lib/billing/checkout-availability";

export const metadata = { title: "Subscribe", robots: { index: false, follow: false } };

/**
 * Where the guest band's Subscribe leads (#636): the ordinary plan choice and
 * Checkout. Subscribing keeps the household membership as it is.
 */
export default async function GuestSubscribePage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const { user } = await requireGuestAccess();

  const [household, checkoutOpen] = await Promise.all([
    getHouseholdOverviewForUser({ userId: user.id }),
    isCheckoutOpen(user),
  ]);
  if (!household) redirect("/pending");
  if (!checkoutOpen) redirect(GUEST_PATH);

  return (
    <AuthScaffold
      title="Subscribe to Tendnote"
      subtitle={`One plan for your own account. You keep your place in ${household.name}.`}
      footer={
        <Link
          href={GUEST_PATH}
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          Back to the library
        </Link>
      }
    >
      <SubscribeForm />
    </AuthScaffold>
  );
}
