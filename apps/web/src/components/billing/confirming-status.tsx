"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";

/** How long the confirming page waits before promising an email instead. */
export const EMAIL_PROMISE_AFTER_MS = 60_000;

/**
 * The confirming page's status line. After a minute it promises the "you're
 * in" email (#607), so the customer can close the tab: admission does not
 * depend on this page staying open.
 */
export function ConfirmingStatus({ email }: { email: string }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), EMAIL_PROMISE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 text-center text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground text-pretty"
    >
      <span className="flex items-center gap-2">
        <Spinner aria-hidden />
        {slow ? "Still confirming" : "Waiting for confirmation"}
      </span>
      {slow ? (
        <p>
          This is taking longer than usual. You can close this page: we'll email{" "}
          <span className="font-medium text-foreground">{email}</span> as soon as you're in.
        </p>
      ) : null}
    </div>
  );
}
