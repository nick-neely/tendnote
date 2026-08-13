"use client";

import {
  NO_RESPONSIBILITY_HOLDER_LABEL,
  RESPONSIBILITY_HANDOFF_PROMPT,
} from "@tendnote/domain/household-actions";
import { useEffect, useState, useTransition } from "react";
import {
  declineGeneralActionOfferAction,
  getResponsibilityHolderReminderOfferAction,
  handGeneralActionToHouseholdAction,
  setResponsibilityHolderAction,
} from "@/app/actions/general-actions";
import {
  type GeneralActionReminderChoice,
  ReminderAlertTimeField,
} from "@/components/general-action-reminder";
import {
  ACTION_CONTROL_TOUCH_TARGET,
  ErrorText,
  GENERIC_ERROR,
} from "@/components/general-action-shared";
import type { ShareableActionMember } from "@/components/general-action-visibility-field";
import { CheckIcon, HomeIcon } from "@/components/icons";
import { pastExactReminderTimeMessage } from "@/components/reminder-past-lead-recovery";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import type { GeneralActionView } from "@/lib/general-action-view";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";
import { useReminderScheduleWriter } from "@/lib/use-reminder-schedule-writer";

/** The sentinel the holder radio group uses for "no one in particular". */
const NOBODY = "__nobody__";

/**
 * Who an Action belongs to, said in one quiet line.
 *
 * Two different sentences, never both: a household-native record is the
 * household's, and a record someone else owns is theirs and shared with you. A
 * household-native record's `ownerUserId` is a storage key, so this must never
 * reach for it — reading it as an author would credit a chore the workspace owns
 * to whoever happened to type it (ADR 0214).
 *
 * Deliberately text with one glyph rather than a pill: a badge would read as a
 * status the row is reporting, and this is only attribution.
 */
function ActionAttribution({
  action,
  members,
}: {
  action: GeneralActionView;
  members: ShareableActionMember[];
}) {
  if (action.ownership === "household_native") {
    return (
      <span className="inline-flex w-fit items-center gap-1 text-[length:var(--text-caption)] text-muted-foreground">
        <HomeIcon aria-hidden className="size-3 shrink-0" />
        Household
      </span>
    );
  }
  if (action.owned) {
    return null;
  }
  const name = members.find((member) => member.userId === action.ownerUserId)?.name ?? null;
  return (
    <span className="text-[length:var(--text-caption)] text-muted-foreground">
      Shared by {name ?? "a household member"}
    </span>
  );
}

/**
 * Who is looking after this, when someone has said so.
 *
 * Renders nothing when nobody is named. That is the ordinary state of a
 * household chore and the calmest one it has, so a placeholder here — "nobody has
 * taken this on" — would turn the quietest case into a reproach (ADR 0215). The
 * label itself is the domain's, so every surface phrases it identically.
 *
 * A member learns they have been named by *seeing this line*, the next time they
 * open the record — never by being told. That is a chosen trade-off, not an
 * oversight: the alternative is a notification, and no member's action may put
 * one on another member's device (ADR 0203). Discovering it late is the price of
 * that rule, and it is the right price. Do not "fix" this with a push.
 */
function ResponsibilityHolderLine({ action }: { action: GeneralActionView }) {
  if (!action.responsibilityHolderLabel) {
    return null;
  }
  return (
    <span className="text-[length:var(--text-caption)] text-muted-foreground">
      {action.responsibilityHolderLabel}
    </span>
  );
}

/**
 * Whose record this is and who is looking after it, on one line.
 *
 * Joined with a separator rather than stacked, because a household row otherwise
 * grows a line taller than a private one for what is two fragments of the same
 * quiet fact. Either half may be absent — an unnamed chore, or your own record —
 * and when both are, the line does not render at all.
 */
export function ActionAttributionLine({
  action,
  members,
}: {
  action: GeneralActionView;
  members: ShareableActionMember[];
}) {
  const attribution = ActionAttribution({ action, members });
  const holder = ResponsibilityHolderLine({ action });
  if (!attribution && !holder) {
    return null;
  }
  return (
    <span className="inline-flex w-fit flex-wrap items-center gap-1.5 text-[length:var(--text-caption)] text-muted-foreground">
      {attribution}
      {attribution && holder ? <span aria-hidden>·</span> : null}
      {holder}
    </span>
  );
}

/** The picker's options: nobody, yourself, then each active co-member. */
function holderOptions(action: GeneralActionView, members: ShareableActionMember[]) {
  return [
    { value: NOBODY, label: NO_RESPONSIBILITY_HOLDER_LABEL },
    { value: action.viewerUserId, label: "You" },
    ...members.map((member) => ({ value: member.userId, label: member.name })),
  ];
}

/**
 * Naming, changing, or clearing who is looking after a household-native record.
 *
 * Any active member may say it, including about themselves, and "no one in
 * particular" is offered as a first-class answer rather than as clearing a field.
 * There is deliberately no "next member" affordance: a rotation would be Tendnote
 * asserting whose turn it is, which is a claim about the past it cannot observe
 * (ADR 0215).
 */
// fallow-ignore-next-line complexity -- The form keeps authority, holder choice, and one reversible submit boundary together so partial household ownership state cannot escape.
export function ResponsibilityHolderForm({
  action,
  members,
  onUpdate,
  onCancel,
}: {
  action: GeneralActionView;
  members: ShareableActionMember[];
  onUpdate: (view: GeneralActionView) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState(action.responsibilityHolderUserId ?? NOBODY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = holderOptions(action, members);
  const changed = choice !== (action.responsibilityHolderUserId ?? NOBODY);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setResponsibilityHolderAction({
          generalActionId: action.id,
          holderUserId: choice === NOBODY ? null : choice,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onUpdate(result.view);
        onCancel();
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-3 px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[length:var(--text-small)] font-medium text-foreground">
          Who's looking after this?
        </legend>
        <RadioGroup className="grid gap-1.5" onValueChange={setChoice} value={choice}>
          {options.map((option) => (
            <Label
              className="min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[length:var(--text-small)] font-normal transition-colors hover:border-primary/45 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-secondary"
              htmlFor={`holder-${action.id}-${option.value}`}
              key={option.value}
            >
              <RadioGroupItem id={`holder-${action.id}-${option.value}`} value={option.value} />
              {option.label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          className={ACTION_CONTROL_TOUCH_TARGET}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          className={ACTION_CONTROL_TOUCH_TARGET}
          disabled={pending || !changed}
          size="sm"
          type="submit"
        >
          {pending ? <Spinner /> : <CheckIcon />}
          Save
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}

/**
 * The hand-off offered in place, right after an occurrence is settled.
 *
 * This is what keeps an alternating chore seamless without Tendnote storing a
 * turn order: the question arrives at the one moment it is natural to answer, and
 * answering it is one tap. Declining costs nothing and leaves the holder exactly
 * as it stands — a settled chore is named once and never touched again.
 *
 * When the acting member is the outgoing holder, the same confirmation offers to
 * take their own reminder with the hand-off. It is a checkbox rather than a
 * consequence: an alert on a member's device is theirs to keep or remove, never
 * something another member's edit does to them (ADR 0203).
 */
export function ResponsibilityHandoffOffer({
  action,
  members,
  onUpdate,
  onDismiss,
}: {
  action: GeneralActionView;
  members: ShareableActionMember[];
  onUpdate: (view: GeneralActionView) => void;
  onDismiss: () => void;
}) {
  const outgoingIsViewer = action.responsibilityHolderUserId === action.viewerUserId;
  const [removeOwnReminder, setRemoveOwnReminder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const candidates = members.filter(
    (member) => member.userId !== action.responsibilityHolderUserId,
  );

  if (candidates.length === 0) {
    return null;
  }

  function handOff(holderUserId: string) {
    setError(null);
    setBusyUserId(holderUserId);
    startTransition(async () => {
      try {
        const result = await setResponsibilityHolderAction({
          generalActionId: action.id,
          holderUserId,
          handedOff: true,
          ...(outgoingIsViewer && removeOwnReminder ? { removeOutgoingReminder: true } : {}),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onUpdate(result.view);
        onDismiss();
      } catch {
        setError(GENERIC_ERROR);
      } finally {
        setBusyUserId(null);
      }
    });
  }

  /**
   * "This one's settled" is the member's statement that this chore does not
   * alternate, and it is remembered for good — the question is never put to them
   * for this record again. It changes nothing about the record itself: the holder
   * stays exactly where it stands, which is the whole point of a settled chore
   * (ADR 0215).
   */
  function decline() {
    onDismiss();
    startTransition(async () => {
      try {
        await declineGeneralActionOfferAction({
          generalActionId: action.id,
          offerKind: "responsibility_handoff",
        });
      } catch {
        // The offer may come back once. Saying so would turn a non-event into a
        // problem the member has to think about.
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
      <p className="text-[length:var(--text-small)] text-foreground">
        {RESPONSIBILITY_HANDOFF_PROMPT}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {candidates.map((member) => (
          <Button
            className={ACTION_CONTROL_TOUCH_TARGET}
            disabled={busyUserId !== null}
            key={member.userId}
            onClick={() => handOff(member.userId)}
            size="sm"
            type="button"
            variant="outline"
          >
            {busyUserId === member.userId ? <Spinner /> : null}
            {member.name}
          </Button>
        ))}
        <Button
          className={`${ACTION_CONTROL_TOUCH_TARGET} text-muted-foreground`}
          disabled={busyUserId !== null}
          onClick={decline}
          size="sm"
          type="button"
          variant="ghost"
        >
          This one's settled
        </Button>
      </div>
      {outgoingIsViewer && action.reminderSchedule ? (
        <Label className="w-fit cursor-pointer items-center gap-2 text-[length:var(--text-caption)] font-normal text-muted-foreground">
          <Checkbox
            checked={removeOwnReminder}
            onCheckedChange={(checked) => setRemoveOwnReminder(checked === true)}
          />
          Remove my reminder for this too
        </Label>
      ) : null}
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}

/**
 * The one-way hand-over of a member-owned Action to the household.
 *
 * Confirmed rather than immediate, and the confirmation says the three things
 * that actually change: the household owns it, every member can edit it, and it
 * stays with the household if this member leaves. There is no claim-back path,
 * because reversing it would mean deciding which member wins a record the
 * workspace owns — so the dialog says that too, plainly, rather than letting the
 * member discover it later (ADR 0214).
 */
export function HandToHouseholdDialog({
  action,
  onUpdate,
  onOpenChange,
  open,
}: {
  action: GeneralActionView;
  onUpdate: (view: GeneralActionView) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function hand() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await handGeneralActionToHouseholdAction({ generalActionId: action.id });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onUpdate(result.view);
        onOpenChange(false);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (pending) return;
        setError(null);
        onOpenChange(next);
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hand this to the household?</AlertDialogTitle>
          <AlertDialogDescription>
            It becomes the household's rather than yours.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="list-disc space-y-1 rounded-lg bg-surface px-4 py-3 pl-8 text-[length:var(--text-small)] text-muted-foreground">
          <li>Everyone in the household can edit it, not just you.</li>
          <li>It stays with the household if you leave.</li>
          <li>There's no way to take it back afterwards.</li>
        </ul>

        {error ? <ErrorText message={error} /> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              hand();
            }}
          >
            {pending ? <Spinner /> : <HomeIcon />}
            Hand to the household
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The one invitation a named Responsibility Holder gets to set their own reminder.
 *
 * Being named is somebody else's statement, so it can never put an alert on this
 * member's device by itself. What it may do is ask, once, inside a surface this
 * member already opened — never as a push, which is exactly the unconsented alert
 * the reminder contract refuses. Whether to ask at all is the server's answer, not
 * this component's guess: it holds the whole rule, including that a member who
 * said no is never asked again (ADR 0203).
 *
 * A record with no due date is not offered one, and that is intended rather than
 * an oversight: a Reminder Schedule is a lead time measured against a domain date
 * (ADR 0203), so an undated Routine has nothing for an alert to be early relative
 * to. Giving it a date makes the offer available at the next naming.
 */
export function HolderReminderOffer({
  action,
  onUpdate,
  suppressed = false,
}: {
  action: GeneralActionView;
  onUpdate: (view: GeneralActionView) => void;
  /**
   * Held back while another question is already on screen. The member who just
   * settled an occurrence is usually also its outgoing holder, so both offers
   * qualify at the same moment — and this is the one that can wait.
   */
  suppressed?: boolean;
}) {
  const reminderWriter = useReminderScheduleWriter();
  const eligible =
    action.ownership === "household_native" &&
    action.responsibilityHolderUserId === action.viewerUserId &&
    Boolean(action.dueAtDate) &&
    !action.reminderSchedule;
  const [offered, setOffered] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [choice, setChoice] = useState<GeneralActionReminderChoice>(() =>
    action.isRoutine ? { kind: "relative", leadMinutes: 0 } : { kind: "exact", localTime: "09:00" },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!eligible) return;
    let live = true;
    void (async () => {
      try {
        const result = await getResponsibilityHolderReminderOfferAction({
          generalActionId: action.id,
        });
        if (live && result.ok && result.view.offer) setOffered(true);
      } catch {
        // A failed ask is simply no offer. Nothing here is worth an error line:
        // the member did not request this, and a reminder they never asked for
        // failing to be suggested is not a problem they have.
      }
    })();
    return () => {
      live = false;
    };
  }, [action.id, eligible]);

  if (!eligible || !offered || dismissed || suppressed) {
    return null;
  }

  function accept() {
    setError(null);
    // fallow-ignore-next-line complexity -- The reminder offer handles the two explicit recovery outcomes beside its single save boundary.
    startTransition(async () => {
      try {
        const result = await reminderWriter.save(
          action.isRoutine ? "routine" : "general_action",
          action.id,
          choice,
        );
        if (result.nextValidChoice) {
          setChoice({ kind: "relative", leadMinutes: 0 });
          setError(`That time has passed. ${result.nextValidChoice.label} is the next one.`);
          return;
        }
        if (!result.occurrenceIntentCreated) {
          setError(pastExactReminderTimeMessage);
          return;
        }
        onUpdate({ ...action, reminderSchedule: toReminderScheduleView(result.schedule) });
        setDismissed(true);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function decline() {
    setDismissed(true);
    startTransition(async () => {
      try {
        await declineGeneralActionOfferAction({
          generalActionId: action.id,
          offerKind: "holder_reminder",
        });
      } catch {
        // Declining is remembered server-side so the offer never returns. If that
        // write fails the offer may come back once; saying so would make a
        // non-event into a problem.
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
      <p className="text-[length:var(--text-small)] text-foreground">
        You're looking after this. Want a reminder on your own devices?
      </p>
      <ReminderAlertTimeField
        allowCustomExactTime={!action.isRoutine}
        choice={choice}
        onChoiceChange={setChoice}
        relativeOnly={action.isRoutine}
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button
          className={`${ACTION_CONTROL_TOUCH_TARGET} text-muted-foreground`}
          disabled={pending}
          onClick={decline}
          size="sm"
          type="button"
          variant="ghost"
        >
          No thanks
        </Button>
        <Button
          className={ACTION_CONTROL_TOUCH_TARGET}
          disabled={pending}
          onClick={accept}
          size="sm"
          type="button"
          variant="outline"
        >
          {pending ? <Spinner /> : <CheckIcon />}
          Remind me
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}
