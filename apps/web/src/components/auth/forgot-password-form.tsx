"use client";

import Link from "next/link";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/client";

export function ForgotPasswordForm() {
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();

    setPending(true);
    setError(null);

    try {
      const { error: requestError } = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (requestError) {
        setError("We couldn't start a password reset. Try again in a moment.");
        setPending(false);
        return;
      }

      // Always show the same confirmation regardless of whether the email exists,
      // so the form never reveals which addresses have accounts.
      setSent(true);
    } catch {
      setError("We couldn't start a password reset. Try again in a moment.");
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          If an account exists for that email, a password reset link has been generated. During the
          private beta we'll deliver it to you shortly — reach out if you don't hear back.
        </p>
        <Button asChild className="w-full" size="lg" variant="outline">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-email`}>Email</Label>
        <Input
          autoComplete="email"
          disabled={pending}
          id={`${formId}-email`}
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </div>

      {error ? (
        <p
          className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Button className="mt-1 w-full" disabled={pending} size="lg" type="submit">
        {pending ? (
          <>
            <Spinner aria-hidden data-icon="inline-start" /> Sending reset link…
          </>
        ) : (
          "Send reset link"
        )}
      </Button>

      <p className="text-center text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        Remembered it?{" "}
        <Link
          className="font-medium text-foreground underline-offset-4 hover:underline"
          href="/sign-in"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
