import { useRef, useState } from "react";
import {
  archiveFollowupAction,
  completeFollowupAction,
  dismissFollowupAction,
  editFollowupAction,
  snoozeFollowupAction,
} from "@/app/actions/followups";
import { GeneralActionReminderField } from "@/components/general-action-reminder";
import {
  AlarmClockIcon,
  ArchiveIcon,
  BellIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PenLineIcon,
  XIcon,
} from "@/components/icons";
import { ErrorText } from "@/components/person-followup-shared";
import { RecordTimingChip } from "@/components/record-timing-chip";
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
import { followupLifecycleAdapter } from "@/lib/followup-reversible-mutation";
import type { FollowupView } from "@/lib/followup-view";
import {
  type ReversibleMutationApplyPhase,
  type ReversibleMutationApplyResult,
  useActiveReversibleMutation,
  useReversibleMutation,
} from "@/lib/reversible-mutation";
import { useReminderSchedule } from "@/lib/use-reminder-schedule";

const FOLLOWUP_MUTATION_INTENTS = ["complete", "dismiss", "archive", "edit"] as const;

function mutationLabels(label: string) {
  return {
    pending: `${label} follow-up…`,
    success: `Follow-up ${label.toLowerCase()}. Undo available.`,
    rollback: `The follow-up was restored after ${label.toLowerCase()} failed.`,
    undo: `Undo ${label}`,
    undone: "Follow-up restored.",
  };
}

/**
 * An active (open or snoozed) reminder row with inline view / edit / snooze modes.
 * Every mutation flows through the shared owner-scoped lifecycle server actions;
 * resolving one animates it out before the parent drops it from the active list.
 */
// fallow-ignore-next-line complexity -- The established row owns coordinated view, edit, snooze, reminder, and exit states; #318 only unwraps the shared owner-action result.
export function ActiveFollowupRow({
  personId,
  followup,
  onMutationFinalize,
  onUpdate,
}: {
  personId: string;
  followup: FollowupView;
  onMutationFinalize?: (id: string) => void;
  onUpdate: (
    view: FollowupView,
    phase?: ReversibleMutationApplyPhase,
  ) => ReversibleMutationApplyResult;
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
  const completeMutation = useReversibleMutation(followup.id, "complete");
  const dismissMutation = useReversibleMutation(followup.id, "dismiss");
  const archiveMutation = useReversibleMutation(followup.id, "archive");
  const updateMutation = useReversibleMutation(followup.id, "edit");
  const activeMutation = useActiveReversibleMutation(followup.id, FOLLOWUP_MUTATION_INTENTS);
  const pending = Boolean(activeMutation?.state.pending);
  const leaving = Boolean(activeMutation?.state.leaving);
  const error = activeMutation?.state.error ?? null;
  const overflowRef = useRef<HTMLButtonElement>(null);

  function applyLeavingView(view: FollowupView) {
    const row = document.getElementById(`followup-${followup.id}`);
    const fallback = row?.nextElementSibling ?? row?.previousElementSibling;
    const heading = row?.closest("section, main")?.querySelector<HTMLElement>("h1, h2, h3");
    const accepted = onUpdate(view);
    requestAnimationFrame(() => {
      const target = fallback?.querySelector<HTMLElement>("button, [tabindex]");
      if (target) target.focus();
      else if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    });
    return accepted;
  }

  // fallow-ignore-next-line complexity -- Three lifecycle intents deliberately share one serialized module entry and one exact-position leave policy.
  function runLifecycle(
    intent: "complete" | "dismiss" | "archive",
    focusTarget: HTMLElement | null,
  ) {
    const command =
      intent === "complete"
        ? completeFollowupAction
        : intent === "dismiss"
          ? dismissFollowupAction
          : archiveFollowupAction;
    const mutation =
      intent === "complete"
        ? completeMutation
        : intent === "dismiss"
          ? dismissMutation
          : archiveMutation;
    const labels = mutationLabels(
      intent === "complete" ? "Complete" : intent === "dismiss" ? "Dismiss" : "Archive",
    );
    mutation.run({
      kind: "optimistic",
      adapter: followupLifecycleAdapter(intent),
      apply: onUpdate,
      command: () => command({ followupId: followup.id }),
      focusTarget,
      labels,
      leave: { apply: applyLeavingView },
      onFinalize: () => onMutationFinalize?.(followup.id),
      prior: followup,
    });
  }

  function runUpdate(
    action: () => ReturnType<typeof editFollowupAction>,
    focusTarget: HTMLElement | null,
  ) {
    updateMutation.run({
      kind: "pending",
      apply: (view, phase) => {
        const accepted = onUpdate(view, phase);
        setMode("view");
        return accepted;
      },
      command: action,
      focusTarget,
      labels: {
        pending: "Saving follow-up…",
        success: "Follow-up saved.",
        rollback: "The follow-up was not changed.",
        undo: "",
        undone: "",
      },
    });
  }

  function cancelEditing() {
    setReason(followup.reason);
    setDueDate(followup.dueAtDate);
    resetReminder(followup.reminderSchedule);
    setMode("view");
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
          runUpdate(
            // fallow-ignore-next-line complexity -- The atomic submit sequences details and reminder state so a row never exposes a partially updated schedule.
            async () => {
              let view = followup;
              if (detailsChanged) {
                const result = await editFollowupAction({
                  followupId: followup.id,
                  edit: {
                    ...(trimmedReason !== followup.reason ? { reason: trimmedReason } : {}),
                    ...(dueDate !== followup.dueAtDate ? { dueAt: dueDate } : {}),
                  },
                });
                if (!result.ok) throw new Error(result.error);
                view = result.view;
              }
              if (reminderEnabled) {
                const reminder = await saveSchedule("follow_up", followup.id);
                view = { ...view, reminderSchedule: reminder.scheduleView };
              } else if (followup.reminderSchedule) {
                await clearSchedule("follow_up", followup.id);
                view = { ...view, reminderSchedule: null };
              }
              return { ok: true as const, view };
            },
            event.nativeEvent.submitter instanceof HTMLElement ? event.nativeEvent.submitter : null,
          );
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
          runUpdate(
            () => snoozeFollowupAction({ followupId: followup.id, dueAt: dueDate }),
            event.nativeEvent.submitter instanceof HTMLElement ? event.nativeEvent.submitter : null,
          );
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
          <RecordTimingChip label={followup.surfaceLabel} state={followup.dueState} />
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
        {activeMutation?.state.undoAvailable ? (
          <Button
            disabled={activeMutation.state.undoRequested}
            onClick={activeMutation.requestUndo}
            size="sm"
            type="button"
            variant="outline"
          >
            {activeMutation.state.undoRequested ? "Undoing…" : activeMutation.state.labels.undo}
          </Button>
        ) : null}
        <Button
          disabled={pending}
          onClick={(event) => runLifecycle("complete", event.currentTarget)}
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
              ref={overflowRef}
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
            <DropdownMenuItem onSelect={() => runLifecycle("dismiss", overflowRef.current)}>
              <XIcon />
              Dismiss
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runLifecycle("archive", overflowRef.current)}>
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
