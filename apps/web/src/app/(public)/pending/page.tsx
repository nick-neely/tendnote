import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SubscribeForm } from "@/components/billing/subscribe-form";
import { ClockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { getCurrentAccess } from "@/lib/access/current-access";
import { isCheckoutOpen } from "@/lib/billing/checkout-availability";

// fallow-ignore-next-line complexity -- One state flow: unauthenticated, admitted, then the pending area with Checkout either open or still behind its flag (#606).
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
  const checkoutOpen = await isCheckoutOpen(user);

  return (
    <AuthScaffold
      title={checkoutOpen ? "Subscribe to Tendnote" : "You're on the list"}
      subtitle={
        checkoutOpen
          ? "Your account is set up. Subscribe to start using Tendnote; you're let in as soon as your first payment is confirmed."
          : "Your account is set up and waiting for Private Beta Access. We'll let you in as soon as it's granted. No need to sign up again."
      }
    >
      <div className="flex flex-col gap-5">
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

        {checkoutOpen ? (
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

        <SignOutButton className="w-full" />
      </div>
    </AuthScaffold>
  );
}
