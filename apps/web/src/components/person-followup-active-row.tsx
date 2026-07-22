import {
  AlarmClockIcon,
  ArchiveIcon,
  BellIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PenLineIcon,
  XIcon,
} from "lucide-react";
import { useState, useTransition } from "react";
import {
  archiveFollowupAction,
  completeFollowupAction,
  dismissFollowupAction,
  editFollowupAction,
  snoozeFollowupAction,
} from "@/app/actions/followups";
import { DueChip } from "@/components/followup-due-chip";
import { GeneralActionReminderField } from "@/components/general-action-reminder";
import { ErrorText, GENERIC_ERROR } from "@/components/person-followup-shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useCreateDraft } from "@/components/use-create-draft";
import type { FollowupView } from "@/lib/followup-view";
import { useReminderSchedule } from "@/lib/use-reminder-schedule";

/**
 * An active (open or snoozed) reminder row with inline view / edit / snooze modes.
 * Every mutation flows through the shared owner-scoped lifecycle server actions;
 * resolving one animates it out before the parent drops it from the active list.
 */
export function ActiveFollowupRow({
  personId,
  followup,
  onResolve,
  onUpdate,
}: {
  personId: string;
  followup: FollowupView;
  onResolve: (id: string) => void;
  onUpdate: (view: FollowupView) => void;
}) {
  const { create: createDraft, pending: draftPending, error: draftError } = useCreateDraft();
  const [mode, setMode] = useState<"view" | "edit" | "snooze">("view");
  const [reason, setReason] = useState(followup.reason);
  const [dueDate, setDueDate] = useState(followup.dueAtDate);
  const {
    choice: reminderChoice,
    clear: clearSchedule,
    enabled: reminderEnabled,
    reset: resetReminder,
    save: saveSchedule,
    setChoice: setReminderChoice,
    setEnabled: setReminderEnabled,
  } = useReminderSchedule(followup.reminderSchedule);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function leaveThen(action: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        setLeaving(true);
        window.setTimeout(() => onResolve(followup.id), 200);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function runUpdate(action: () => Promise<FollowupView>) {
    setError(null);
    startTransition(async () => {
      try {
        onUpdate(await action());
        setMode("view");
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function cancelEditing() {
    setReason(followup.reason);
    setDueDate(followup.dueAtDate);
    resetReminder(followup.reminderSchedule);
    setMode("view");
    setError(null);
  }

  const trimmedReason = reason.trim();

  if (mode === "edit") {
    const currentReminderChoice = followup.reminderSchedule
      ? followup.reminderSchedule.kind === "relative"
        ? { kind: "relative" as const, leadMinutes: followup.reminderSchedule.leadMinutes ?? 0 }
        : { kind: "exact" as const, localTime: followup.reminderSchedule.localTime ?? "09:00" }
      : null;
    const reminderChanged =
      reminderEnabled !== Boolean(followup.reminderSchedule) ||
      JSON.stringify(reminderChoice) !== JSON.stringify(currentReminderChoice);
    const detailsChanged = trimmedReason !== followup.reason || dueDate !== followup.dueAtDate;
    const unchanged = !detailsChanged && !reminderChanged;

    return (
      <form
        className="flex flex-col gap-2.5 px-4 py-3.5"
        // This atomic edit submit coordinates details and Reminder replacement/clear so the row
        // cannot display a partially updated schedule; component tests cover its visible states.
        // fallow-ignore-next-line complexity
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedReason || unchanged) {
            return;
          }
          runUpdate(async () => {
            let view = detailsChanged
              ? await editFollowupAction({
                  followupId: followup.id,
                  edit: {
                    ...(trimmedReason !== followup.reason ? { reason: trimmedReason } : {}),
                    ...(dueDate !== followup.dueAtDate ? { dueAt: dueDate } : {}),
                  },
                })
              : followup;
            if (reminderEnabled) {
              const reminder = await saveSchedule("follow_up", followup.id);
              view = { ...view, reminderSchedule: reminder.scheduleView };
            } else if (followup.reminderSchedule) {
              await clearSchedule("follow_up", followup.id);
              view = { ...view, reminderSchedule: null };
            }
            return view;
          });
        }}
      >
        <Input
          aria-label="Follow-up reason"
          onChange={(event) => setReason(event.target.value)}
          value={reason}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Input
            aria-label="Due date"
            className="w-44"
            onChange={(event) => setDueDate(event.target.value)}
            type="date"
            value={dueDate}
          />
          <div className="flex items-center gap-1.5">
            <Button onClick={cancelEditing} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={pending || !trimmedReason || unchanged} size="sm" type="submit">
              <CheckIcon />
              Save
            </Button>
          </div>
        </div>
        <GeneralActionReminderField
          choice={reminderChoice}
          enabled={reminderEnabled}
          onChoiceChange={setReminderChoice}
          onEnabledChange={setReminderEnabled}
        />
        {error ? <ErrorText message={error} /> : null}
      </form>
    );
  }

  if (mode === "snooze") {
    const unchanged = dueDate === followup.dueAtDate;

    return (
      <form
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (unchanged) {
            return;
          }
          runUpdate(() => snoozeFollowupAction({ followupId: followup.id, dueAt: dueDate }));
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="text-[length:var(--text-caption)] text-muted-foreground">
            Snooze until
          </span>
          <Input
            aria-label="Snooze until"
            className="w-44"
            onChange={(event) => setDueDate(event.target.value)}
            type="date"
            value={dueDate}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Button onClick={cancelEditing} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending || unchanged} size="sm" type="submit" variant="outline">
            <AlarmClockIcon />
            Snooze
          </Button>
        </div>
        {error ? <ErrorText message={error} /> : null}
      </form>
    );
  }

  return (
    <article
      className="scroll-mt-40 flex flex-col gap-2 px-4 py-3.5 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={leaving}
      id={`followup-${followup.id}`}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <p className="max-w-[52ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
            {followup.reason}
          </p>
          <span className="text-[length:var(--text-caption)] text-muted-foreground">
            {followup.visibilityLabel}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <DueChip dueLabel={followup.dueLabel} dueState={followup.dueState} />
          {followup.status === "snoozed" ? (
            <span className="text-[length:var(--text-caption)] text-muted-foreground">Snoozed</span>
          ) : null}
          {followup.reminderSchedule ? (
            <span className="inline-flex items-center gap-1 text-[length:var(--text-caption)] text-muted-foreground">
              <BellIcon className="size-3" />
              {followup.reminderSchedule.label}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          disabled={pending}
          onClick={() => leaveThen(() => completeFollowupAction({ followupId: followup.id }))}
          size="sm"
          type="button"
          variant="outline"
        >
          <CheckIcon />
          Complete
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="More actions"
              disabled={pending}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={draftPending}
              onSelect={() =>
                createDraft({
                  personId,
                  followupContext: { id: followup.id, reason: followup.reason },
                })
              }
            >
              <PenLineIcon />
              Draft a message
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setMode("snooze")}>
              <AlarmClockIcon />
              Snooze
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMode("edit")}>
              <PencilIcon />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => leaveThen(() => dismissFollowupAction({ followupId: followup.id }))}
            >
              <XIcon />
              Dismiss
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => leaveThen(() => archiveFollowupAction({ followupId: followup.id }))}
            >
              <ArchiveIcon />
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error ? <ErrorText message={error} /> : null}
      {draftError ? <ErrorText message={draftError} /> : null}
    </article>
  );
}
