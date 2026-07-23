import { redirect } from "next/navigation";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ClockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { getCurrentAccess } from "@/lib/access/current-access";

export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const access = await getCurrentAccess();

  if (access.state === "unauthenticated") {
    redirect("/sign-in");
  }

  if (access.state === "admitted") {
    redirect("/");
  }

  const { user } = access;
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase() || "?";

  return (
    <AuthScaffold
      title="You're on the list"
      subtitle="Your account is set up and waiting for Private Beta Access. We'll let you in as soon as it's granted. No need to sign up again."
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

        <div className="flex items-center justify-between gap-3 rounded-lg border bg-surface px-3 py-2.5">
          <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            Access status
          </span>
          <Badge variant="secondary">
            <ClockIcon aria-hidden data-icon="inline-start" />
            Pending review
          </Badge>
        </div>

        <SignOutButton className="w-full" />
      </div>
    </AuthScaffold>
  );
}
