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
      {/*
        Two states, and each says only what its own state has not already said.
        Turned on, the section directly above this has just named the brief and
        promised that only this member sees it, so repeating both here was the
        same two sentences twice within a screen; what is left is the one fact
        neither the section nor the button carries — the cap, and that it is
        bounded by what this member can already see. Turned off there is no
        section, so the offer states the promise itself, at the moment the
        member is being asked to make the decision.
      */}
      <p className="max-w-[65ch] text-[length:var(--text-small)] text-muted-foreground text-pretty leading-[var(--text-small-line)]">
        {enabled
          ? "The check-in shows up to three shared records you can currently see."
          : "Add up to three shared records you can currently see to your own brief. Only you would see it."}
      </p>
      {/*
        A command button with a stateful label, not a switch.
        `aria-pressed` would announce "Add a check-in to my brief, pressed",
        which is wrong twice: the label already names the action about to happen
        rather than a setting's name, and a toggle-button's pressed state is
        meant to be read alongside a *stable* label. The two labels here are
        different sentences — "Add" and "Remove" — so the state is carried by the
        words a screen reader already reads, and adding a pressed state would
        announce it a second time in the opposite polarity.

        `role="switch"` was the other candidate and needs a stable label plus an
        on/off value; that is the shape of a settings row, and this is a single
        consequential action with an outcome sentence beneath it.
      */}
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
