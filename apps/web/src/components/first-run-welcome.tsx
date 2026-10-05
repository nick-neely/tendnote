"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { skipFirstRunAction } from "@/app/actions/first-run";
import { Button } from "@/components/ui/button";
import {
  FIRST_RUN_QUESTION,
  FIRST_RUN_SKIPPED_HREF,
  FIRST_RUN_WELCOME_DETAIL,
} from "@/lib/first-run-copy";
import { cn } from "@/lib/utils";

/**
 * The one first-run prompt, standing where Home's greeting stands (#639). It is
 * an invitation into the composer beside it, never a gate: the rest of Home is
 * already usable, and Skip lands on the same Home with the question repeated
 * once in the empty Today rail and the composer.
 */
export function FirstRunWelcome({ variant }: { variant: "dashboard" | "band" }) {
  return (
    <header className="flex flex-col gap-1" data-first-run="welcome">
      <h1
        className={cn(
          "text-balance font-semibold",
          variant === "dashboard"
            ? "font-display text-[length:var(--text-display)] leading-[var(--text-display-line)] tracking-normal"
            : "text-[length:var(--text-h1)] leading-[var(--text-h1-line)]",
        )}
      >
        You’re in. {FIRST_RUN_QUESTION}
      </h1>
      <p className="max-w-[65ch] text-pretty text-muted-foreground text-sm">
        {FIRST_RUN_WELCOME_DETAIL}
      </p>
    </header>
  );
}

/** Skip the first run; it lands on the Home that repeats the prompt once. */
export function FirstRunSkipButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <Button
        className="min-h-11 px-3 text-muted-foreground"
        disabled={pending}
        onClick={() => {
          setFailed(false);
          startTransition(async () => {
            const result = await skipFirstRunAction().catch(() => null);
            if (!result?.ok) {
              setFailed(true);
              return;
            }
            router.replace(FIRST_RUN_SKIPPED_HREF);
          });
        }}
        type="button"
        variant="ghost"
      >
        {pending ? "Skipping…" : "Skip for now"}
      </Button>
      {failed ? (
        <p className="px-3 text-[length:var(--text-small)] text-destructive" role="alert">
          Couldn’t skip just now. Try again.
        </p>
      ) : null}
    </div>
  );
}
