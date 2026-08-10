"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setHouseholdCheckinAction } from "@/app/actions/household-checkin";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const GENERIC_FAILURE = "That didn't go through. Nothing changed.";

/**
 * The member's own choice about whether their brief carries a household
 * check-in.
 *
 * It lives on Household rather than in the brief because an offer sitting in
 * someone's private briefing for a thing they have not asked for is itself a
 * small nag — and because this is a household-shaped decision, made where the
 * household lives. Turning it on adds a short read to that member's own
 * briefing; turning it off removes it. Neither touches a household record, and
 * neither is visible to another member.
 *
 * Two states, one control, and the copy says which way it goes rather than
 * naming an abstract setting.
 */
export function HouseholdCheckinChoice({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const outcome = await setHouseholdCheckinAction({ enabled: !enabled });
      if (!outcome.ok) {
        setError(outcome.error || GENERIC_FAILURE);
        return;
      }
      setStatus(
        outcome.view.enabled
          ? "Your brief will include a household check-in."
          : "Your brief no longer includes a household check-in.",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-[65ch] text-[length:var(--text-small)] text-muted-foreground text-pretty leading-[var(--text-small-line)]">
        {enabled
          ? "Your own brief shows up to three shared records you can currently see. Only you see it."
          : "Add up to three shared records you can currently see to your own brief. Only you would see it."}
      </p>
      <Button
        className="min-h-11 w-fit"
        disabled={pending}
        onClick={toggle}
        size="sm"
        type="button"
        variant="outline"
      >
        {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
        {enabled ? "Remove the check-in from my brief" : "Add a check-in to my brief"}
      </Button>
      <p
        className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)] empty:hidden"
        role="status"
      >
        {pending ? "Saving…" : status}
      </p>
      {error ? (
        <p
          className="text-[length:var(--text-small)] text-destructive leading-[var(--text-small-line)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
