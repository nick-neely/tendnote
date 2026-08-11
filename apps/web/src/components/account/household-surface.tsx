"use client";

import {
  HOUSEHOLD_RECOVERY_WINDOW_DAYS,
  HOUSEHOLD_SUPPORT_EMAIL,
} from "@tendnote/domain/household-governance";
import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { HOUSEHOLD_NAME_LIMIT } from "@tendnote/domain/household-policy";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from "react";
import {
  type CreateHouseholdActionInput,
  createHouseholdAction as defaultCreateHouseholdAction,
  type HouseholdOverviewResult,
} from "@/app/actions/households";
import type {
  HouseholdEnding,
  HouseholdGovernanceActions,
} from "@/components/account/household-governance-panel";
import type { HouseholdInvitationActions } from "@/components/account/household-invitations-panel";
import type { HouseholdMemberGovernanceActions } from "@/components/account/household-member-actions";
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
 *
 * The swap runs both ways. Leaving or ending a household ends the caller's own
 * membership, which is what the Overview is read through, so the same screen
 * becomes the activation form again without a navigation — the way back in is
 * exactly where the way out was.
 *
 * It does not become the form immediately, though. An ending gets a resting
 * state first: the household someone just left or ended is replaced by a short
 * account of what happened, and only when they move on does the activation form
 * appear. Swapping straight to a blank "Start a household" would leave the only
 * confirmation in a live region — nothing a sighted reader sees — and it would
 * offer a new household as the answer to having just closed one. The resting
 * state is also where the outcome is stated truthfully when the screen was a
 * moment out of date and the press did more than its label said.
 */
export function HouseholdSurface({
  initialOverview,
  createHouseholdAction = defaultCreateHouseholdAction,
  invitationActions,
  governanceActions,
  memberActions,
  contextSection,
  sharedSections,
}: {
  initialOverview: HouseholdOverview | null;
  createHouseholdAction?: CreateHouseholdAction;
  invitationActions?: HouseholdInvitationActions;
  governanceActions?: HouseholdGovernanceActions;
  memberActions?: HouseholdMemberGovernanceActions;
  /**
   * Household Context, composed on the server and slotted in.
   *
   * A node rather than data because the section is a read the server already
   * did; passing the facts through here would make this client boundary
   * responsible for content it never touches. It disappears with the Overview
   * the moment the household ends, which is exactly when household context stops
   * being the reader's to see.
   */
  contextSection?: React.ReactNode;
  /**
   * The household's shared content - its calendars and Event Plans - read on
   * the server and handed in. It appears only alongside an Overview: the same
   * active membership that makes one readable is what makes the other readable,
   * and a household that has just been left or ended has neither.
   */
  sharedSections?: React.ReactNode;
}) {
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const [createdHere, setCreatedHere] = useState(false);
  const [ending, setEnding] = useState<HouseholdEnding | null>(null);
  const [startedFromEnding, setStartedFromEnding] = useState(false);
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
        <HouseholdOverviewPanel
          contextSection={contextSection}
          focusOnMount={createdHere}
          governanceActions={governanceActions}
          invitationActions={invitationActions}
          memberActions={memberActions}
          onAnnounce={setAnnouncement}
          // The action's own answer is the new Overview, so the seat count,
          // invitation rows, and every governance answer change on the press;
          // the server tree catches up underneath rather than being what the
          // reader waits for. `null` is the answer to leaving or ending, and it
          // returns this surface to activation.
          onOverviewChange={(next, ended) => {
            setOverview(next);
            setCreatedHere(false);
            if (!next && ended) setEnding(ended);
            router.refresh();
          }}
          overview={overview}
          sharedSections={sharedSections}
        />
      ) : ending ? (
        <HouseholdEnded
          ending={ending}
          onStartAnother={() => {
            setEnding(null);
            setStartedFromEnding(true);
          }}
        />
      ) : (
        <HouseholdActivation
          createHouseholdAction={createHouseholdAction}
          // The two ways someone arrives at a bare activation form: never having
          // had a household, or having just closed the resting state of one. The
          // second destroyed the control they pressed, so focus needs a landing.
          focusOnMount={startedFromEnding}
          onCreate={(created) => {
            setOverview(created);
            setCreatedHere(true);
            setStartedFromEnding(false);
            setAnnouncement(`${created.name} is ready. You're its owner.`);
          }}
        />
      )}
    </>
  );
}

/**
 * Where a household ends: one heading, what happened, and no more than that.
 *
 * It is a page in the same calm register as the rest of the surface — no alarm
 * treatment, no destructive color. The ending was already agreed to; this is the
 * receipt for it, and a receipt does not shout. The only control is a quiet way
 * on, and it is deliberately not the thing the eye lands on: someone who has
 * just closed a household is rarely here to open another one.
 *
 * The dissolution copy says what the system does, both halves of it: support can
 * put the household back for {@link HOUSEHOLD_RECOVERY_WINDOW_DAYS} days, and
 * when that window closes what the household itself held is deleted (#391).
 * The second sentence stayed unsaid until the purge sweep existed to keep it;
 * now that it does, leaving it out would understate what ending a household
 * costs at the one moment someone is deciding whether to do it.
 */
function HouseholdEnded({
  ending,
  onStartAnother,
}: {
  ending: HouseholdEnding;
  onStartAnother: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // The control that got here was inside a dialog that has now unmounted, so
    // without this focus falls to the document body at the moment the task ends.
    headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="household-ended-heading"
      className="flex flex-col gap-4 rounded-xl border bg-surface px-4 py-5 sm:px-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          className="text-[length:var(--text-h2)] leading-[var(--text-h2-line)] font-semibold tracking-normal text-balance outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
          id="household-ended-heading"
          ref={headingRef}
          tabIndex={-1}
        >
          {ending.kind === "left" ? `You've left ${ending.name}` : `${ending.name} has ended`}
        </h2>
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          {ending.kind === "left" ? (
            <>
              Your access ended, and what you shared there is no longer visible to the household.
              Everything you wrote is still yours. Coming back would need a fresh invitation.
            </>
          ) : (
            <>
              Everyone&rsquo;s access ended and its live invitations stopped working. What each
              person wrote stays theirs. For the next {HOUSEHOLD_RECOVERY_WINDOW_DAYS} days, support
              can still put the household back &mdash; write to{" "}
              <a
                className="underline underline-offset-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35 focus-visible:outline-none"
                href={`mailto:${HOUSEHOLD_SUPPORT_EMAIL}`}
              >
                {HOUSEHOLD_SUPPORT_EMAIL}
              </a>
              . After that, what the household itself held is deleted.
            </>
          )}
        </p>
      </div>
      <Button
        className="min-h-11 self-start sm:min-h-8"
        onClick={onStartAnother}
        size="sm"
        type="button"
        variant="outline"
      >
        Start a household
      </Button>
    </section>
  );
}

function HouseholdActivation({
  createHouseholdAction,
  focusOnMount = false,
  onCreate,
}: {
  createHouseholdAction: CreateHouseholdAction;
  focusOnMount?: boolean;
  onCreate: (overview: HouseholdOverview) => void;
}) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameId = useId();
  const hintId = useId();
  const durabilityId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmedName = name.trim();

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

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
        {/* A focus landing, not a control: `tabIndex={-1}` keeps it out of the tab order. */}
        <h2
          className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
          id="household-activation-heading"
          ref={headingRef}
          tabIndex={-1}
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
          This once said a household was a one-way door, because leaving and
          dissolution were not built. They are now, so the sentence says what is
          true: the exits exist, they are deliberate, and ending one is not
          casually undone. Renaming still is not built, so the name is still the
          part worth pausing over.
        */}
        <p
          className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground"
          id={durabilityId}
        >
          You can leave a household later, and its owners can end it together — but nothing here
          renames one, so pick a name you&rsquo;ll still want.
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
