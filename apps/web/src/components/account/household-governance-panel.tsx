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
/** Carries what the pressed control said it would do, for the server to check. */
type DissolutionConfirmAction = (input: {
  endsNow: boolean;
}) => Promise<HouseholdDissolutionResult>;

export type HouseholdGovernanceActions = {
  acceptOffer?: OverviewAction;
  declineOffer?: OverviewAction;
  stepDown?: OverviewAction;
  leave?: DepartureAction;
  confirmDissolution?: DissolutionConfirmAction;
  cancelDissolution?: DissolutionAction;
};

/**
 * How a household stopped being the reader's, told by the server's own answer.
 *
 * The two endings look identical to the surface — the Overview becomes `null` —
 * and read completely differently to the person. It travels beside the `null` so
 * the screen that replaces the household can say which one happened.
 *
 * It is derived from what came back, never from what was pressed. A screen that
 * is one confirmation out of date can offer "End this household" for a press
 * that only agrees - another owner withdrew in between - and the answer knows
 * that while the label does not. The opposite mistake is not left to the label
 * to get right: a press offered as an ordinary agreement that would in fact end
 * the household is declined by the server rather than announced after the fact.
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
 *
 * A household of one has one exit, and only that one is drawn. Stepping down and
 * leaving are both held by the last-owner rule when nobody else is here, so both
 * rows could only ever render the sentence saying so — two refusals stacked
 * above the single control that does work, which reads as a screen mostly made
 * of things the reader cannot do. What those two sentences were teaching is a
 * single fact, that ending it is how a household of one closes, and the
 * dissolution row says it directly instead. This is a presentation choice and
 * nothing else: the rules, the server's answers, and both rows come back
 * untouched — blocked notes included — the moment a second person is here, where
 * "you can't leave yet" is news and names what would unblock it.
 */
export function HouseholdEndingsPanel({
  overview,
  actions = {},
  onOverviewChange,
  onAnnounce,
}: PanelProps) {
  // Read off the answers rather than off the seat count alone, so the rule is
  // "hide the rows that could only be a refusal" rather than "a lone reader has
  // no exits". The last-owner rule means a household of one always answers this
  // way, but this panel is not the thing that guarantees that — and if a lone
  // reader ever did have a departure open to them, hiding it would take away
  // the only door they had.
  const refusalsOnly =
    overview.isSoleMember && !overview.stepDown.available && !overview.departure.available;
  return (
    <section aria-labelledby="household-endings-heading" className="flex flex-col gap-3">
      <h2
        className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
        id="household-endings-heading"
      >
        Leaving and ending
      </h2>
      <div className="flex flex-col gap-4 rounded-xl border bg-surface px-4 py-4 sm:px-5">
        {refusalsOnly ? null : (
          <>
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
          </>
        )}
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
      {/* 4px, the rhythm's tight step, as every other title-and-line pair here. */}
      <div className="flex flex-col gap-1">
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
    // One line to know this is the row, no more: the dialog below already tells
    // the whole of it, this line's second half included, to the reader who has
    // decided to look.
    <ExitRow description="Your access ends right away." title="Leaving this household">
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
 * What an owner sees once they have already agreed.
 *
 * An agreement is a commitment, not an act: nothing has happened yet, so the
 * only control is the way back out and the copy says who is still to answer.
 */
function DissolutionWithdrawal({
  error,
  householdName,
  onWithdraw,
  pending,
  stillWaitingOn,
}: {
  error: string | null;
  householdName: string;
  onWithdraw: () => void;
  pending: boolean;
  stillWaitingOn: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
        You&rsquo;ve agreed to end {householdName}. It stays exactly as it is until the{" "}
        {stillWaitingOn === 1 ? "other owner agrees" : `other ${stillWaitingOn} owners agree`} too.
      </p>
      <Button
        className="min-h-11 self-start sm:min-h-8"
        disabled={pending}
        onClick={onWithdraw}
        size="sm"
        type="button"
        variant="outline"
      >
        {pending ? "Changing…" : "Change my mind"}
      </Button>
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}

/**
 * The retyped-phrase gate, shown only for the press that actually ends things.
 *
 * The boundary and the door through it travel together: naming support as the
 * only way back and then not saying how to reach them would leave the reader
 * with a rule and no recourse.
 */
function DissolutionPhraseGate({
  error,
  errorId,
  onTyped,
  pending,
  phrase,
  typed,
}: {
  error: string | null;
  errorId: string;
  onTyped: (value: string) => void;
  pending: boolean;
  phrase: string;
  typed: string;
}) {
  return (
    <>
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
          // The refusal below is about this press, and this input is the only
          // field in the dialog — wired rather than left to `role="alert"`,
          // which announces once and is gone for anyone who arrives at the
          // field afterwards.
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          // Typing the phrase is the only next action in this gated dialog.
          autoFocus
          disabled={pending}
          id="household-dissolve-confirm"
          onChange={(event) => onTyped(event.target.value)}
          // Retyping is the safeguard; pasting the on-screen phrase defeats it.
          onDrop={(event) => event.preventDefault()}
          onPaste={(event) => event.preventDefault()}
          placeholder={phrase}
          spellCheck={false}
          value={typed}
        />
      </div>
    </>
  );
}

/**
 * The dialog behind both presses, which read differently on purpose.
 *
 * `endsNow` decides every word and the weight of the confirm: an agreement that
 * still waits on another owner changes nothing yet and must not borrow the alarm
 * of the press that ends a household.
 */
function DissolutionDialog({
  canConfirm,
  endsNow,
  error,
  errorId,
  householdName,
  onConfirm,
  onOpenChange,
  onTyped,
  open,
  pending,
  phrase,
  stillWaitingOn,
  typed,
}: {
  canConfirm: boolean;
  endsNow: boolean;
  error: string | null;
  errorId: string;
  householdName: string;
  onConfirm: () => void;
  onOpenChange: (next: boolean) => void;
  onTyped: (value: string) => void;
  open: boolean;
  pending: boolean;
  phrase: string;
  stillWaitingOn: number;
  typed: string;
}) {
  const othersLeft = stillWaitingOn - 1;
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
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
            {endsNow ? `End ${householdName}?` : `Agree to end ${householdName}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {endsNow
              ? `Everyone's access ends the moment you press this, and every live invitation stops working. For ${HOUSEHOLD_RECOVERY_WINDOW_DAYS} days afterwards support can still put the household back; after that, what the household itself held is deleted. What each person wrote privately stays theirs.`
              : `Nothing changes yet. The household ends only once every owner has agreed, and you can change your mind until then. ${othersLeft === 1 ? "One other owner" : `${othersLeft} other owners`} would still need to agree.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {endsNow ? (
          <DissolutionPhraseGate
            error={error}
            errorId={errorId}
            onTyped={onTyped}
            pending={pending}
            phrase={phrase}
            typed={typed}
          />
        ) : null}

        {error ? <ErrorText id={errorId} message={error} /> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep the household</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            // Destructive weight belongs to the press that actually ends
            // something. An agreement that still waits on another owner
            // changes nothing yet and must not borrow the alarm.
            variant={endsNow ? "destructive" : "default"}
          >
            {pending ? (endsNow ? "Ending…" : "Agreeing…") : endsNow ? "End it" : "Agree to end it"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
 * The window is described as how long support can still put it back, with the
 * address to reach them travelling alongside, and it now also says what happens
 * when the window closes: the purge sweep deletes what the household itself held
 * (#391). Before that sweep existed the copy deliberately stopped short of
 * promising deletion, because nothing performed it. It no longer has to.
 *
 * This function owns the state and the writes; the three components above own
 * the reading of them. The split is why none of them has to hold the whole of
 * agreement, withdrawal, and irreversible ending at once.
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
   * The pending-and-error scaffolding both presses share. What each one made
   * true is read off the answer by `settle`, never off the control that was
   * pressed - `endsNow` below is a reading of an Overview that may be a moment
   * old, and the server is the only thing that cannot be stale.
   */
  function run(action: DissolutionAction, settle: (view: HouseholdOverview | null) => void) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        settle(result.view.view);
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  /**
   * What the confirmation turned out to be, in the three readings the answer can
   * have.
   *
   * An Overview that still says this owner has not confirmed is the server
   * declining the press: it was offered here as an ordinary agreement, and by
   * the time it arrived it was the last one needed. Nothing was recorded, and
   * that same Overview is what turns this dialog into the final question - the
   * phrase gate included. The alternative is a household ending under a control
   * whose own copy promised "nothing changes yet".
   */
  function settleConfirmation(view: HouseholdOverview | null) {
    if (view && !view.dissolution.viewerHasConfirmed) {
      onOverviewChange(view);
      onAnnounce(
        `Another owner agreed while this was open. Yours is now the press that ends ${overview.name}.`,
      );
      return;
    }
    setOpen(false);
    const ended = view === null;
    onOverviewChange(view, ended ? { kind: "dissolved", name: overview.name } : undefined);
    onAnnounce(ended ? `${overview.name} has ended.` : `You've agreed to end ${overview.name}.`);
  }

  if (!dissolution.available) {
    // A plain member reaches this branch and is meant to: the end of the
    // household is a fact about *their* household, so the rule that governs it
    // is theirs to read even though no control follows from it. Every other
    // governance answer on this screen is about what one person may do to
    // another, and those stay silent for a member.
    if (!dissolution.blockedReason) return null;
    return (
      <ExitRow
        description="Ending a household is an owner decision, and every owner has to agree."
        title="Ending this household"
      >
        <BlockedNote reason={dissolution.blockedReason} />
      </ExitRow>
    );
  }

  const stillWaitingOn = dissolution.required - dissolution.confirmed;
  // The press that finishes it: nobody but this reader is left to agree.
  const endsNow = !dissolution.viewerHasConfirmed && stillWaitingOn === 1;

  return (
    <ExitRow
      // In a household of one this is the only exit drawn, so its line carries
      // the fact the departure row would otherwise have taught: with nobody to
      // hand the household to, ending it is how it closes. The recovery window
      // stays on the row either way — an owner who only ever agrees to a
      // dissolution never reaches the final dialog that states it.
      description={
        overview.isSoleMember
          ? `You're the only person here, so ending it is how this household closes. Support can put it back for ${HOUSEHOLD_RECOVERY_WINDOW_DAYS} days afterwards.`
          : `Every owner has to agree. Once they all do, it closes for everyone, and support can put it back for ${HOUSEHOLD_RECOVERY_WINDOW_DAYS} days.`
      }
      title="Ending this household"
    >
      {dissolution.viewerHasConfirmed ? (
        <DissolutionWithdrawal
          error={error}
          householdName={overview.name}
          onWithdraw={() =>
            run(cancel, (view) => {
              onOverviewChange(view);
              onAnnounce(`Ending ${overview.name} was called off.`);
            })
          }
          pending={pending}
          stillWaitingOn={stillWaitingOn}
        />
      ) : (
        <DissolutionDialog
          canConfirm={!pending && (!endsNow || confirmPhraseMatches(typed, phrase))}
          endsNow={endsNow}
          error={error}
          errorId={errorId}
          householdName={overview.name}
          onConfirm={() => run(() => confirm({ endsNow }), settleConfirmation)}
          onOpenChange={handleOpenChange}
          onTyped={setTyped}
          open={open}
          pending={pending}
          phrase={phrase}
          stillWaitingOn={stillWaitingOn}
          typed={typed}
        />
      )}
      {error && !open && !dissolution.viewerHasConfirmed ? <ErrorText message={error} /> : null}
    </ExitRow>
  );
}
