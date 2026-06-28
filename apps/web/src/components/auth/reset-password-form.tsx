"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/client";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");

    setPending(true);
    setError(null);

    try {
      const { error: requestError } = await authClient.resetPassword({ newPassword, token });

      if (requestError) {
        setError(
          requestError.message ??
            "We couldn't reset your password. The link may have expired — request a new one.",
        );
        setPending(false);
        return;
      }

      router.push("/sign-in");
      router.refresh();
    } catch {
      setError("We couldn't reset your password. The link may have expired — request a new one.");
      setPending(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${formId}-password`}>New password</Label>
        <Input
          aria-describedby={`${formId}-password-hint`}
          autoComplete="new-password"
          disabled={pending}
          id={`${formId}-password`}
          minLength={8}
          name="password"
          placeholder="••••••••"
          required
          type="password"
        />
        <p
          className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground"
          id={`${formId}-password-hint`}
        >
          At least 8 characters.
        </p>
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
            <Spinner aria-hidden data-icon="inline-start" /> Saving new password…
          </>
        ) : (
          "Save new password"
        )}
      </Button>

      <p className="text-center text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        <Link
          className="font-medium text-foreground underline-offset-4 hover:underline"
          href="/sign-in"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
