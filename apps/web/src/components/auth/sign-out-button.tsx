"use client";

import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { signOut } from "@/lib/auth/client";

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
