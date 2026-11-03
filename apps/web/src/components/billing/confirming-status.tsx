"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAdmissionPolling } from "./use-admission-polling";

/** How long the confirming page waits before promising an email instead. */
export const EMAIL_PROMISE_AFTER_MS = 60_000;

/** What the status says at each stage of waiting. */
const STAGES = {
  waiting: { heading: "Waiting for confirmation", lead: null },
  slow: { heading: "Still confirming", lead: "This is taking longer than usual." },
  stopped: {
    heading: "Still waiting for confirmation",
    lead: "We've stopped checking automatically.",
  },
} as const;

/**
 * The confirming page's status. It checks the admission record on a bounded
 * schedule (#765) and after a minute promises the "you're in" email (#607),
 * so the customer can close the tab: admission does not depend on this page
 * staying open. Once automatic checks stop it stays a calm waiting state with
 * a manual check, because slow confirmation says nothing about the payment.
 */
export function ConfirmingStatus({ email }: { email: string }) {
  const [slow, setSlow] = useState(false);
  const { stopped, checking, checkAgain } = useAdmissionPolling();

  // Counted from the first render, so a page restored from an Activity keeps its place.
  const firstRenderedAt = useRef<number | null>(null);
  useEffect(() => {
    firstRenderedAt.current ??= performance.now();
    const remaining = EMAIL_PROMISE_AFTER_MS - (performance.now() - firstRenderedAt.current);
    const timer = window.setTimeout(() => setSlow(true), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, []);

  const stage = STAGES[stopped ? "stopped" : slow ? "slow" : "waiting"];

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        role="status"
        className="flex flex-col items-center gap-2 text-center text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground text-pretty"
      >
        <span className="flex items-center gap-2">
          {stopped ? null : <Spinner aria-hidden />}
          {stage.heading}
        </span>
        {stage.lead ? (
          <p>
            {stage.lead} You can close this page: we'll email{" "}
            <span className="font-medium text-foreground">{email}</span> as soon as you're in.
          </p>
        ) : null}
      </div>
      {stopped ? (
        <Button
          type="button"
          variant="outline"
          // Not `disabled`, so keyboard focus stays on the control while it checks.
          aria-disabled={checking || undefined}
          onClick={checkAgain}
          className="aria-disabled:cursor-default aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-disabled:active:translate-y-0 aria-disabled:hover:bg-muted aria-disabled:hover:text-muted-foreground"
        >
          {checking ? <Spinner data-icon="inline-start" aria-hidden /> : null}
          {checking ? "Checking" : "Check again"}
        </Button>
      ) : null}
    </div>
  );
}
