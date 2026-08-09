"use client";

import {
  HOUSEHOLD_RECOVERY_IS_SUPPORT_ONLY,
  HOUSEHOLD_RECOVERY_WINDOW_DAYS,
  HOUSEHOLD_SUPPORT_EMAIL,
} from "@tendnote/domain/household-governance";
import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { useId, useState, useTransition } from "react";
import {
  acceptHouseholdOwnerRoleAction as defaultAcceptOfferAction,
  cancelHouseholdDissolutionAction as defaultCancelDissolutionAction,
  confirmHouseholdDissolutionAction as defaultConfirmDissolutionAction,
  declineHouseholdOwnerRoleAction as defaultDeclineOfferAction,
  leaveHouseholdAction as defaultLeaveAction,
  stepDownFromHouseholdOwnerAction as defaultStepDownAction,
  type HouseholdDissolutionResult,
} from "@/app/actions/household-governance";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmPhraseMatches, generateConfirmPhrase } from "@/lib/confirm-phrase";
import { HOUSEHOLD_GENERIC_ERROR } from "@/lib/household/invitation-copy";
import type { OwnerActionResult } from "@/lib/owner-action-result";

type OverviewAction = () => Promise<OwnerActionResult<HouseholdOverview>>;
type DepartureAction = () => Promise<OwnerActionResult<{ view: HouseholdOverview | null }>>;
type DissolutionAction = () => Promise<HouseholdDissolutionResult>;

export type HouseholdGovernanceActions = {
  acceptOffer?: OverviewAction;
  declineOffer?: OverviewAction;
  stepDown?: OverviewAction;
  leave?: DepartureAction;
  confirmDissolution?: DissolutionAction;
  cancelDissolution?: DissolutionAction;
};

/**
 * How a household stopped being the reader's, told by the server's own answer.
 *
 * The two endings look identical to the surface — the Overview becomes `null` —
 * and read completely differently to the person. It travels beside the `null` so
 * the screen that replaces the household can say which one happened.
 *
 * It is derived from what came back, never from what was pressed. A reader whose
 * screen was one confirmation out of date presses a control labelled "agree" and
 * ends the household; the answer knows that and the label does not.
 */
export type HouseholdEnding = {
  kind: "left" | "dissolved";
  name: string;
};

/**
 * `ending` is present only alongside a `null` Overview, and only for the person
 * whose own standing ended. Optional rather than a second callback so the many
 * ordinary governance moves, which only ever hand back a new Overview, are not
 * made to think about endings.
 */
export type HouseholdOverviewChange = (
  overview: HouseholdOverview | null,
  ending?: HouseholdEnding,
) => void;

type PanelProps = {
  overview: HouseholdOverview;
  actions?: HouseholdGovernanceActions;
  onOverviewChange: HouseholdOverviewChange;
  onAnnounce: (message: string) => void;
};

function ErrorText({ id, message }: { id?: string; message: string }) {
  return (
    <p
      className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-destructive"
      id={id}
      role="alert"
    >
      {message}
    </p>
  );
}

/**
 * The question someone is asked when they are offered co-ownership.
 *
 * It sits above the people list rather than in the footer with the exits,
 * because it is the one thing on this screen waiting on the reader — and it is
 * an invitation, not an ending. The copy says what the role does and, just as
 * importantly, what it does not: an Owner governs the household, and that has
 * never meant seeing anyone's private notes.
 */
export function HouseholdOwnerOffer({
  overview,
  actions = {},
  onOverviewChange,
  onAnnounce,
}: PanelProps) {
  const accept = actions.acceptOffer ?? defaultAcceptOfferAction;
  const decline = actions.declineOffer ?? defaultDeclineOfferAction;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const offer = overview.ownerOffer;
  if (!offer) return null;

  function run(action: OverviewAction, announce: string) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onOverviewChange(result.view);
        onAnnounce(announce);
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  return (
    <section
      aria-labelledby="household-owner-offer-heading"
      className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-4 sm:px-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium text-balance"
          id="household-owner-offer-heading"
        >
          {offer.offeredByName} asked you to co-own {overview.name}
        </h2>
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          Owners look after invitations and who&rsquo;s here, and no owner can remove another. It
          doesn&rsquo;t open anyone&rsquo;s private notes to you, or yours to them. You can say no,
          and you can be asked again later.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={() => run(accept, `You're now an owner of ${overview.name}.`)}
          type="button"
        >
          {pending ? "Accepting…" : "Become an owner"}
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={() => run(decline, "You stayed a member. Nothing changed.")}
          type="button"
          variant="ghost"
        >
          Not now
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </section>
  );
}

/**
 * The exits, at the foot of the household.
 *
 * They are deliberately last and deliberately quiet: leaving and ending are real
 * and reachable — this screen no longer claims a household is permanent — but
 * they are not what the surface is about. Each one states what actually happens
 * before it happens, and the only destructive treatment on the screen is on the
 * final press inside a confirmation, never on a heading, a blocked state, or an
 * ordinary membership change.
 */
export function HouseholdEndingsPanel({
  overview,
  actions = {},
  onOverviewChange,
  onAnnounce,
}: PanelProps) {
  return (
    <section aria-labelledby="household-endings-heading" className="flex flex-col gap-3">
      <h2
        className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
        id="household-endings-heading"
      >
        Leaving and ending
      </h2>
      <div className="flex flex-col gap-4 rounded-xl border bg-surface px-4 py-4 sm:px-5">
        <StepDownRow
          actions={actions}
          onAnnounce={onAnnounce}
          onOverviewChange={onOverviewChange}
          overview={overview}
        />
        <DepartureRow
          actions={actions}
          onAnnounce={onAnnounce}
          onOverviewChange={onOverviewChange}
          overview={overview}
        />
        <DissolutionRow
          actions={actions}
          onAnnounce={onAnnounce}
          onOverviewChange={onOverviewChange}
          overview={overview}
        />
      </div>
    </section>
  );
}

/**
 * One exit: a sentence of what it means, then the control or the reason it waits.
 *
 * The titles are gerunds ("Leaving this household") while the controls are
 * imperatives ("Leave household"). That is not a stylistic tic: a title and a
 * button carrying the same words give two elements the same accessible name in
 * one region, and someone moving through this by control list cannot tell the
 * heading from the thing that acts.
 *
 * `description` is one line — enough to know whether this is the row you want,
 * not the full account of what it does. That belongs in the dialog, where it is
 * read by someone who has decided to look. Saying it in both places twice over
 * makes the screen heavier and teaches the reader to skip the second one.
 */
function ExitRow({
  title,
  children,
  description,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <p className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
          {title}
        </p>
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

/** A quiet statement that a rule is holding something, never a disabled control. */
function BlockedNote({ reason }: { reason: string }) {
  return (
    <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
      {reason}
    </p>
  );
}

function StepDownRow({ overview, actions = {}, onOverviewChange, onAnnounce }: PanelProps) {
  const stepDown = actions.stepDown ?? defaultStepDownAction;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (overview.viewerRole !== "owner") return null;

  return (
    <ExitRow
      description="Stay in the household without looking after invitations or who's here. Nobody else can do this to you."
      title="Stepping down as an owner"
    >
      {overview.stepDown.available ? (
        <Button
          className="min-h-11 self-start sm:min-h-8"
          disabled={pending}
          onClick={() => {
            if (pending) return;
            setError(null);
            startTransition(async () => {
              try {
                const result = await stepDown();
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                onOverviewChange(result.view);
                onAnnounce("You're a member here now.");
              } catch {
                setError(HOUSEHOLD_GENERIC_ERROR);
              }
            });
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {pending ? "Stepping down…" : "Step down"}
        </Button>
      ) : overview.stepDown.blockedReason ? (
        <BlockedNote reason={overview.stepDown.blockedReason} />
      ) : null}
      {error ? <ErrorText message={error} /> : null}
    </ExitRow>
  );
}

function DepartureRow({ overview, actions = {}, onOverviewChange, onAnnounce }: PanelProps) {
  const leave = actions.leave ?? defaultLeaveAction;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <ExitRow
      description="Your access ends right away. What you wrote stays yours."
      title="Leaving this household"
    >
      {overview.departure.available ? (
        <AlertDialog
          onOpenChange={(next) => {
            if (pending) return;
            setOpen(next);
            if (next) setError(null);
          }}
          open={open}
        >
          <AlertDialogTrigger asChild>
            <Button
              className="min-h-11 self-start sm:min-h-8"
              size="sm"
              type="button"
              variant="outline"
            >
              Leave household
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave {overview.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Your access ends the moment you press this. Anything you shared with people here
                stops being visible to them, and anything they shared with you disappears from your
                view. Everything you wrote is still yours. Coming back would need a fresh
                invitation.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error ? <ErrorText message={error} /> : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Stay</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  if (pending) return;
                  setError(null);
                  startTransition(async () => {
                    try {
                      const result = await leave();
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      setOpen(false);
                      onOverviewChange(result.view.view, {
                        kind: "left",
                        name: overview.name,
                      });
                      onAnnounce(`You've left ${overview.name}.`);
                    } catch {
                      setError(HOUSEHOLD_GENERIC_ERROR);
                    }
                  });
                }}
                variant="destructive"
              >
                {pending ? "Leaving…" : "Leave household"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : overview.departure.blockedReason ? (
        <BlockedNote reason={overview.departure.blockedReason} />
      ) : null}
      {error && !open ? <ErrorText message={error} /> : null}
    </ExitRow>
  );
}

/**
 * The end of the household, which no one Owner can decide alone.
 *
 * Two different presses live here and read differently on purpose. Where other
 * Owners are still to agree, confirming is an ordinary commitment that can be
 * withdrawn, so it gets ordinary weight and says who it is waiting on. Where
 * this press is the last one needed, it ends the household now — so it asks for
 * a retyped phrase, names the {@link HOUSEHOLD_RECOVERY_WINDOW_DAYS}-day window,
 * and states plainly that getting it back afterwards is not something anyone can
 * do from inside Tendnote.
 *
 * What the copy must not say is that anything is deleted. Ending a household
 * marks it dissolved and stops every access; no sweep removes its records when
 * the window closes, and none is built until #391. So the window is described as
 * how long support can still put it back — the promise the product actually
 * keeps — and the address to reach them travels with it.
 */
function DissolutionRow({ overview, actions = {}, onOverviewChange, onAnnounce }: PanelProps) {
  const confirm = actions.confirmDissolution ?? defaultConfirmDissolutionAction;
  const cancel = actions.cancelDissolution ?? defaultCancelDissolutionAction;
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { dissolution } = overview;
  if (!dissolution.available) {
    // A plain member reaches this branch and is meant to: the end of the
    // household is a fact about *their* household, so the rule that governs it
    // is theirs to read even though no control follows from it. Every other
    // governance answer on this screen is about what one person may do to
    // another, and those stay silent for a member.
    return dissolution.blockedReason ? (
      <ExitRow
        description="Ending a household is an owner decision, and every owner has to agree to it."
        title="Ending this household"
      >
        <BlockedNote reason={dissolution.blockedReason} />
      </ExitRow>
    ) : null;
  }

  const stillWaitingOn = dissolution.required - dissolution.confirmed;
  // The press that finishes it: nobody but this reader is left to agree.
  const endsNow = !dissolution.viewerHasConfirmed && stillWaitingOn === 1;
  const phraseConfirmed = confirmPhraseMatches(typed, phrase);
  const canConfirm = !pending && (!endsNow || phraseConfirmed);

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) {
      // A fresh phrase each time: the point is a deliberate read-and-type, not a
      // string someone remembers from the last time they opened this.
      setPhrase(generateConfirmPhrase());
      setTyped("");
    }
    setError(null);
  }

  /**
   * `announce` is a function of the answer, not of the press.
   *
   * `endsNow` above is a reading of an Overview that may be a moment old: if
   * another owner agreed in between, a press this screen labelled "Agree to end
   * it" is the one that ends the household. The server settles that, and it
   * settles it in the only way that cannot be stale — the reader has an Overview
   * afterwards, or they do not. Announcing the label rather than the outcome
   * would tell that person their household still stands when it has just ended.
   */
  function run(
    action: DissolutionAction,
    announce: (ended: boolean) => string,
    close: boolean,
    ending?: (ended: boolean) => HouseholdEnding | undefined,
  ) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (close) setOpen(false);
        const ended = result.view.view === null;
        onOverviewChange(result.view.view, ending?.(ended));
        onAnnounce(announce(ended));
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  return (
    <ExitRow
      description={`Every owner has to agree. Once they all do, the household closes for everyone and support can put it back for ${HOUSEHOLD_RECOVERY_WINDOW_DAYS} days.`}
      title="Ending this household"
    >
      {dissolution.viewerHasConfirmed ? (
        <div className="flex flex-col gap-2">
          <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
            You&rsquo;ve agreed to end {overview.name}. It stays exactly as it is until the{" "}
            {stillWaitingOn === 1 ? "other owner agrees" : `other ${stillWaitingOn} owners agree`}{" "}
            too.
          </p>
          <Button
            className="min-h-11 self-start sm:min-h-8"
            disabled={pending}
            onClick={() => run(cancel, () => `Ending ${overview.name} was called off.`, false)}
            size="sm"
            type="button"
            variant="outline"
          >
            {pending ? "Changing…" : "Change my mind"}
          </Button>
          {error ? <ErrorText message={error} /> : null}
        </div>
      ) : (
        <AlertDialog onOpenChange={handleOpenChange} open={open}>
          <AlertDialogTrigger asChild>
            <Button
              className={`min-h-11 self-start text-muted-foreground sm:min-h-8${
                endsNow ? " hover:text-destructive" : ""
              }`}
              size="sm"
              type="button"
              variant="ghost"
            >
              {endsNow ? "End this household" : "Agree to end it"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {endsNow ? `End ${overview.name}?` : `Agree to end ${overview.name}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {endsNow
                  ? `Everyone's access ends the moment you press this, and every live invitation stops working. For ${HOUSEHOLD_RECOVERY_WINDOW_DAYS} days afterwards support can still put the household back; after that, treat it as final. What each person wrote privately stays theirs.`
                  : `Nothing changes yet. The household ends only once every owner has agreed, and you can change your mind until then. ${stillWaitingOn - 1 === 1 ? "One other owner" : `${stillWaitingOn - 1} other owners`} would still need to agree.`}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {endsNow ? (
              <>
                {/*
                  The boundary and the door through it, in one paragraph. Naming
                  support as the only way back and then not saying how to reach
                  them would leave the reader with a rule and no recourse.
                */}
                <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
                  {HOUSEHOLD_RECOVERY_IS_SUPPORT_ONLY} If you need to, write to{" "}
                  <a
                    className="underline underline-offset-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35 focus-visible:outline-none"
                    href={`mailto:${HOUSEHOLD_SUPPORT_EMAIL}`}
                  >
                    {HOUSEHOLD_SUPPORT_EMAIL}
                  </a>
                  .
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label
                    className="block text-[length:var(--text-small)] leading-[var(--text-small-line)] font-normal text-muted-foreground"
                    htmlFor="household-dissolve-confirm"
                  >
                    Type{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem] font-medium text-foreground select-none">
                      {phrase}
                    </code>{" "}
                    to confirm
                  </Label>
                  <Input
                    // The refusal below is about this press, and this input is
                    // the only field in the dialog — wired rather than left to
                    // `role="alert"`, which announces once and is gone for
                    // anyone who arrives at the field afterwards.
                    aria-describedby={error ? errorId : undefined}
                    aria-invalid={error ? true : undefined}
                    autoComplete="off"
                    // Typing the phrase is the only next action in this gated dialog.
                    autoFocus
                    disabled={pending}
                    id="household-dissolve-confirm"
                    onChange={(event) => setTyped(event.target.value)}
                    // Retyping is the safeguard; pasting the on-screen phrase defeats it.
                    onDrop={(event) => event.preventDefault()}
                    onPaste={(event) => event.preventDefault()}
                    placeholder={phrase}
                    spellCheck={false}
                    value={typed}
                  />
                </div>
              </>
            ) : null}

            {error ? <ErrorText id={errorId} message={error} /> : null}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Keep the household</AlertDialogCancel>
              <AlertDialogAction
                disabled={!canConfirm}
                onClick={(event) => {
                  event.preventDefault();
                  run(
                    confirm,
                    (ended) =>
                      ended
                        ? `${overview.name} has ended.`
                        : `You've agreed to end ${overview.name}.`,
                    true,
                    (ended) => (ended ? { kind: "dissolved", name: overview.name } : undefined),
                  );
                }}
                // Destructive weight belongs to the press that actually ends
                // something. An agreement that still waits on another owner
                // changes nothing yet and must not borrow the alarm.
                variant={endsNow ? "destructive" : "default"}
              >
                {pending
                  ? endsNow
                    ? "Ending…"
                    : "Agreeing…"
                  : endsNow
                    ? "End it"
                    : "Agree to end it"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {error && !open && !dissolution.viewerHasConfirmed ? <ErrorText message={error} /> : null}
    </ExitRow>
  );
}
