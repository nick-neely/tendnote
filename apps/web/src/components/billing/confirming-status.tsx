"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAdmissionPolling } from "./admission-poller";

/** How long the confirming page waits before promising an email instead. */
export const EMAIL_PROMISE_AFTER_MS = 60_000;

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

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), EMAIL_PROMISE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const recipient = <span className="font-medium text-foreground">{email}</span>;

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        role="status"
        className="flex flex-col items-center gap-2 text-center text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground text-pretty"
      >
        <span className="flex items-center gap-2">
          {stopped ? null : <Spinner aria-hidden />}
          {stopped
            ? "Still waiting for confirmation"
            : slow
              ? "Still confirming"
              : "Waiting for confirmation"}
        </span>
        {stopped ? (
          <p>
            We've stopped checking automatically. You can close this page: we'll email {recipient}{" "}
            as soon as you're in.
          </p>
        ) : slow ? (
          <p>
            This is taking longer than usual. You can close this page: we'll email {recipient} as
            soon as you're in.
          </p>
        ) : null}
      </div>
      {stopped ? (
        <Button
          type="button"
          variant="outline"
          aria-disabled={checking}
          onClick={checkAgain}
          className="aria-disabled:text-muted-foreground"
        >
          {checking ? <Spinner data-icon="inline-start" aria-hidden /> : null}
          {checking ? "Checking" : "Check again"}
        </Button>
      ) : null}
    </div>
  );
}
