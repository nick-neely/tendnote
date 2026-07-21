"use client";

import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { signOut } from "@/lib/auth/client";
import { clearAllLocalComposerDrafts } from "@/lib/local-composer-draft";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    if (pending) {
      return;
    }

    setPending(true);

    try {
      await signOut();
      try {
        clearAllLocalComposerDrafts(window.localStorage);
      } catch {
        // Successful sign-out must still navigate when device storage is blocked.
      }
      router.push("/sign-in");
      router.refresh();
    } catch {
      // A failed sign-out (e.g. network) must not leave the button stuck disabled.
      setPending(false);
    }
  }

  return (
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
  );
}
