"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { disableCurrentReminderInstallationAction } from "@/app/actions/reminders";
import { LogOutIcon } from "@/components/icons";
import { useReminderInstallation } from "@/components/reminder-installation-context";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { signOut } from "@/lib/auth/client";
import { safeReturnTo } from "@/lib/auth/return-to";
import { clearAllLocalComposerDrafts } from "@/lib/local-composer-draft";
import { unsubscribeReminderRegistration } from "@/lib/reminder-registration";

export function SignOutButton({
  className,
  returnTo,
}: {
  className?: string;
  /**
   * Where to land after signing out. Defaults to sign-in, which is what someone
   * leaving the app wants. A caller passes this when the sign-out is a step
   * inside something else the visitor is still doing — holding an invitation
   * whose link would otherwise be lost. Run through `safeReturnTo` so a
   * destination assembled from URL data can only ever be a path on this site.
   */
  returnTo?: string;
}) {
  const router = useRouter();
  const installation = useReminderInstallation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    if (pending) {
      return;
    }

    setPending(true);
    setError(null);

    const clientInstallationId = installation?.clientInstallationId;
    if (clientInstallationId) {
      try {
        await disableCurrentReminderInstallationAction({
          clientInstallationId,
          reason: "sign_out",
        });
        await unsubscribeReminderRegistration(
          "serviceWorker" in navigator ? navigator.serviceWorker : null,
        );
      } catch {
        setPending(false);
        setError("Tendnote couldn't turn reminders off before sign-out. Try again.");
        return;
      }
    }

    try {
      await signOut();
      try {
        clearAllLocalComposerDrafts(window.localStorage);
      } catch {
        // Successful sign-out must still navigate when device storage is blocked.
      }
      router.push(returnTo ? safeReturnTo(returnTo) : "/sign-in");
      router.refresh();
    } catch {
      // A failed sign-out (e.g. network) must not leave the button stuck disabled.
      setPending(false);
      setError("Tendnote couldn't sign you out. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        className={className}
        disabled={pending}
        onClick={handleSignOut}
        type="button"
        variant="outline"
      >
        {pending ? <Spinner aria-hidden /> : <LogOutIcon aria-hidden data-icon="inline-start" />}
        Sign out
      </Button>
      {error ? (
        <p className="text-[length:var(--text-small)] text-muted-foreground" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
