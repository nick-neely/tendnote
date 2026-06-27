import {
  AlarmClockIcon,
  ArchiveIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
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
import type { FollowupView } from "@/lib/followup-view";

/**
 * An active (open or snoozed) reminder row with inline view / edit / snooze modes.
 * Every mutation flows through the shared owner-scoped lifecycle server actions;
 * resolving one animates it out before the parent drops it from the active list.
 */
export function ActiveFollowupRow({
  followup,
  onResolve,
  onUpdate,
}: {
  followup: FollowupView;
  onResolve: (id: string) => void;
  onUpdate: (view: FollowupView) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "snooze">("view");
  const [reason, setReason] = useState(followup.reason);
  const [dueDate, setDueDate] = useState(followup.dueAtDate);
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
    setMode("view");
    setError(null);
  }

  const trimmedReason = reason.trim();

  if (mode === "edit") {
    const unchanged = trimmedReason === followup.reason && dueDate === followup.dueAtDate;

    return (
      <form
        className="flex flex-col gap-2.5 px-4 py-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedReason || unchanged) {
            return;
          }
          runUpdate(() =>
            editFollowupAction({
              followupId: followup.id,
              edit: {
                ...(trimmedReason !== followup.reason ? { reason: trimmedReason } : {}),
                ...(dueDate !== followup.dueAtDate ? { dueAt: dueDate } : {}),
              },
            }),
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
      className="flex flex-col gap-2 px-4 py-3.5 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={leaving}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-[52ch] text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
          {followup.reason}
        </p>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <DueChip dueLabel={followup.dueLabel} dueState={followup.dueState} />
          {followup.status === "snoozed" ? (
            <span className="text-[length:var(--text-caption)] text-muted-foreground">Snoozed</span>
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
    </article>
  );
}
