"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { signIn, signUp } from "@/lib/auth/client";
import { GithubSignInButton } from "./github-sign-in-button";

type Mode = "sign-in" | "sign-up";

const COPY = {
  "sign-in": {
    submit: "Sign in",
    pending: "Signing in…",
    fallbackError: "We couldn't sign you in. Check your email and password and try again.",
    switchPrompt: "New to Tendnote?",
    switchHref: "/sign-up",
    switchLabel: "Create an account",
  },
  "sign-up": {
    submit: "Create account",
    pending: "Creating your account…",
    fallbackError: "We couldn't create your account. Try again in a moment.",
    switchPrompt: "Already have an account?",
    switchHref: "/sign-in",
    switchLabel: "Sign in",
  },
} as const;

// fallow-ignore-next-line complexity -- The established auth form keeps sign-in and sign-up state aligned in one boundary.
export function CredentialsForm({
  mode,
  githubEnabled = false,
  returnTo = "/",
}: {
  mode: Mode;
  githubEnabled?: boolean;
  returnTo?: string;
}) {
  const router = useRouter();
  const copy = COPY[mode];
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fallow-ignore-next-line complexity -- One submit transaction owns validation, auth, error recovery, and navigation.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "").trim();

    setPending(true);
    setError(null);

    try {
      const { error: requestError } =
        mode === "sign-up"
          ? await signUp.email({ email, password, name: name || email })
          : await signIn.email({ email, password });

      if (requestError) {
        setError(requestError.message ?? copy.fallbackError);
        setPending(false);
        return;
      }

      // Land on the dashboard; the access gate routes a still-pending signup to
      // the pending area, and refresh re-reads the new session on the server.
      // Keep the button disabled through navigation rather than re-enabling it.
      router.push(returnTo);
      router.refresh();
    } catch {
      // A thrown request (e.g. network failure) never returns a `requestError`,
      // so re-enable the form and explain instead of leaving it stuck.
      setError(copy.fallbackError);
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {githubEnabled ? (
        <>
          <GithubSignInButton
            label={mode === "sign-up" ? "Sign up with GitHub" : "Continue with GitHub"}
            returnTo={returnTo}
          />
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-px flex-1 bg-border" />
            <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              or with email
            </span>
            <span aria-hidden className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {mode === "sign-up" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input
              autoComplete="name"
              disabled={pending}
              id={`${formId}-name`}
              name="name"
              placeholder="Ada Lovelace"
              type="text"
            />
          </div>
        ) : null}

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

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${formId}-password`}>Password</Label>
            {mode === "sign-in" ? (
              <Link
                className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                href="/forgot-password"
              >
                Forgot?
              </Link>
            ) : null}
          </div>
          <Input
            aria-describedby={mode === "sign-up" ? `${formId}-password-hint` : undefined}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            disabled={pending}
            id={`${formId}-password`}
            minLength={8}
            name="password"
            placeholder="••••••••"
            required
            type="password"
          />
          {mode === "sign-up" ? (
            <p
              className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground"
              id={`${formId}-password-hint`}
            >
              At least 8 characters.
            </p>
          ) : null}
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
              <Spinner aria-hidden data-icon="inline-start" /> {copy.pending}
            </>
          ) : (
            copy.submit
          )}
        </Button>

        <p className="text-center text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          {copy.switchPrompt}{" "}
          <Link
            className="font-medium text-foreground underline-offset-4 hover:underline"
            href={copy.switchHref}
          >
            {copy.switchLabel}
          </Link>
        </p>
      </form>
    </div>
  );
}
