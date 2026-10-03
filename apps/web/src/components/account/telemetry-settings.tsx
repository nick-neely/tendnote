"use client";

import { useId, useRef, useState, useTransition } from "react";
import { setTelemetryOptOutAction } from "@/app/actions/telemetry";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const GENERIC_FAILURE = "That didn't go through. Nothing changed.";

/**
 * The one setting for optional telemetry: account funnel events and
 * third-party error reports, together.
 *
 * Worded as what is shared, so the default reads as a plain fact rather than a
 * pre-ticked consent trap, and the sentence underneath says exactly what is and
 * is not in it. Activation Milestones are product records and are not named:
 * this setting does not switch them off, and listing them here would suggest it
 * does.
 *
 * Like the Approval Mode, it moves before the write lands and moves back if the
 * write fails, and only the newest choice may settle the box.
 */
export function TelemetrySettings({ optedOut: initialOptedOut }: { optedOut: boolean }) {
  const headingId = useId();
  const fieldId = useId();
  const descriptionId = useId();
  const [sharing, setSharing] = useState(!initialOptedOut);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const latestChoice = useRef(0);

  function choose(next: boolean) {
    if (next === sharing) return;
    const previous = sharing;
    latestChoice.current += 1;
    const choice = latestChoice.current;
    setSharing(next);
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await setTelemetryOptOutAction({ optedOut: !next });
        if (choice !== latestChoice.current) return;
        if (!outcome.ok) {
          setSharing(previous);
          setError(outcome.error || GENERIC_FAILURE);
          return;
        }
        setSharing(!outcome.view.optedOut);
      } catch {
        if (choice !== latestChoice.current) return;
        setSharing(previous);
        setError(GENERIC_FAILURE);
      }
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          className="font-medium text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
          id={headingId}
        >
          Analytics and error reports
        </h2>
        <p className="max-w-[65ch] text-[length:var(--text-small)] text-muted-foreground">
          Never your notes, the people in them, or anything you write.
        </p>
      </div>

      <Label
        className="cursor-pointer items-start gap-3 rounded-lg border bg-surface p-3.5 font-normal text-[length:var(--text-body)] transition-colors hover:border-primary/45"
        htmlFor={fieldId}
      >
        <Checkbox
          aria-describedby={descriptionId}
          checked={sharing}
          className="mt-1"
          id={fieldId}
          onCheckedChange={(checked) => choose(checked === true)}
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium text-foreground">
            Share account analytics and error reports
          </span>
          <span
            className="max-w-[65ch] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
            id={descriptionId}
          >
            Tendnote notes when your account first reaches a few fixed steps, like subscribing or
            saving your first person. It also covers error reports, if Tendnote sends them; those
            never carry your name, email, or account. Turning it off stops both from now on.
          </span>
        </span>
      </Label>

      {/* Holds one line while empty, so a round trip never moves the page. */}
      <p
        aria-live="polite"
        className="min-h-[var(--text-small-line)] text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
        role="status"
      >
        {pending ? "Saving…" : null}
      </p>
      {error ? (
        <p
          className="text-[length:var(--text-small)] text-destructive leading-[var(--text-small-line)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
