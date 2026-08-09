"use client";

import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { HOUSEHOLD_NAME_LIMIT } from "@tendnote/domain/household-policy";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import {
  type CreateHouseholdActionInput,
  createHouseholdAction as defaultCreateHouseholdAction,
  type HouseholdOverviewResult,
} from "@/app/actions/households";
import { HouseholdOverviewPanel } from "@/components/account/household-overview-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const GENERIC_ERROR = "That didn't go through. Nothing changed, so you can try again.";

export type CreateHouseholdAction = (
  input: CreateHouseholdActionInput,
) => Promise<HouseholdOverviewResult>;

/**
 * Account's Household entry and return point.
 *
 * One surface holds both states so activation never feels like leaving Account:
 * a user with no active household names one here and stays put while the same
 * screen becomes their Overview. A user who already has one is only ever shown
 * the Overview — and if a stale client still submits a creation, the private
 * admission conflict is rendered in place rather than navigating anywhere.
 */
export function HouseholdSurface({
  initialOverview,
  createHouseholdAction = defaultCreateHouseholdAction,
}: {
  initialOverview: HouseholdOverview | null;
  createHouseholdAction?: CreateHouseholdAction;
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [createdHere, setCreatedHere] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  return (
    <>
      {/*
        Mounted in both states and empty until something happens. A live region
        inserted at the same moment as its text is unreliably announced, and the
        creation swap replaces the whole subtree — so the region has to outlive
        the swap to carry the confirmation across it.
      */}
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
      {overview ? (
        // Creation destroys the control that was focused, which would otherwise
        // drop focus to the document body at the moment the task completes.
        <HouseholdOverviewPanel focusOnMount={createdHere} overview={overview} />
      ) : (
        <HouseholdActivation
          createHouseholdAction={createHouseholdAction}
          onCreate={(created) => {
            setOverview(created);
            setCreatedHere(true);
            setAnnouncement(`${created.name} is ready. You're its owner.`);
          }}
        />
      )}
    </>
  );
}

function HouseholdActivation({
  createHouseholdAction,
  onCreate,
}: {
  createHouseholdAction: CreateHouseholdAction;
  onCreate: (overview: HouseholdOverview) => void;
}) {
  const router = useRouter();
  const nameId = useId();
  const hintId = useId();
  const durabilityId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmedName = name.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const created = await createHouseholdAction({ name: trimmedName });
        if (!created.ok) {
          setError(created.error);
          return;
        }
        // Swap to the Overview from the action's own answer so the return point
        // is there immediately, then let the server tree catch up underneath.
        onCreate(created.view);
        router.refresh();
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <section
      aria-labelledby="household-activation-heading"
      className="flex flex-col gap-4 rounded-xl border bg-surface px-4 py-5 sm:px-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
          id="household-activation-heading"
        >
          Start a household
        </h2>
        <p
          className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground"
          id={hintId}
        >
          Name it and it&rsquo;s ready. You&rsquo;ll be its owner. Nothing you&rsquo;ve already
          written moves into it, and nothing is shared until you choose to share it.
        </p>
        {/*
          Creating a household is currently a one-way door: renaming, leaving,
          and dissolution are not built. Stating that plainly at the decision
          point is more respectful than letting the calm tone imply it is
          casually reversible — and it promises nothing about later.
        */}
        <p
          className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground"
          id={durabilityId}
        >
          A household is durable: nothing here renames or removes one, so pick a name you&rsquo;ll
          still want later.
        </p>
      </div>

      <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={submit}>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={nameId}>Household name</Label>
          <Input
            aria-describedby={`${hintId} ${durabilityId}`}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            className="h-11 sm:h-8"
            id={nameId}
            maxLength={HOUSEHOLD_NAME_LIMIT}
            name="householdName"
            onChange={(event) => setName(event.target.value)}
            placeholder="The Neely house"
            value={name}
          />
        </div>
        <Button
          // Comfortable touch target on phones; matched to the compact input at
          // pointer widths so the pair does not read as two different scales.
          className="min-h-11 w-full sm:min-h-8 sm:w-auto"
          disabled={pending || trimmedName.length === 0}
          type="submit"
        >
          {pending ? "Creating…" : "Create household"}
        </Button>
      </form>

      {error ? (
        <p
          className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
