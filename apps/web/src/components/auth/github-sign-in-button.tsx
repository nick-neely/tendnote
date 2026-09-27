"use client";

import { useState } from "react";
import { GithubIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { signIn } from "@/lib/auth/client";

/**
 * GitHub sign-in. Rendered only when GitHub OAuth is configured (the server
 * decides). GitHub users land in the same Private Beta Access gate as
 * email/password users, since the user-create hook gives every signup a profile.
 */
export function GithubSignInButton({
  additionalData,
  disabled = false,
  label,
  returnTo = "/",
}: {
  /** Carried through the OAuth flow to the account-create hook, e.g. clickwrap acceptance. */
  additionalData?: Record<string, unknown>;
  disabled?: boolean;
  label: string;
  returnTo?: string;
}) {
  const [pending, setPending] = useState(false);

  async function handleSignIn() {
    if (pending) {
      return;
    }

    setPending(true);

    try {
      await signIn.social({ provider: "github", callbackURL: returnTo, additionalData });
    } catch {
      // signIn.social redirects on success; only a failure to start returns here.
      setPending(false);
    }
  }

  return (
    <Button
      className="w-full"
      disabled={pending || disabled}
      onClick={handleSignIn}
      type="button"
      variant="outline"
    >
      {pending ? (
        <Spinner aria-hidden data-icon="inline-start" />
      ) : (
        <GithubIcon aria-hidden data-icon="inline-start" />
      )}
      {label}
    </Button>
  );
}
