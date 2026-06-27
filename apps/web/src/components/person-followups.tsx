"use client";

import {
  AlarmClockIcon,
  ArchiveIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { useState, useTransition } from "react";
import {
  archiveFollowupAction,
  completeFollowupAction,
  createFollowupAction,
  dismissFollowupAction,
  editFollowupAction,
  reopenFollowupAction,
  snoozeFollowupAction,
} from "@/app/actions/followups";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { FollowupDueState, FollowupView } from "@/lib/followup-view";

const RESOLVED_STATUS_LABEL: Record<string, string> = {
  completed: "Done",
  dismissed: "Dismissed",
};

const GENERIC_ERROR = "That didn't go through. Try again.";

function sortByDue(followups: FollowupView[]): FollowupView[] {
  return [...followups].sort((a, b) => a.dueAtISO.localeCompare(b.dueAtISO));
}

/**
 * The timely-state cue. Calm by design: clay accent (never red) for due/today,
 * quiet muted text for upcoming, and always a word — never color alone (DESIGN.md
 * §3, §6; PRD #42). Overdue reads as a plain "Was due {date}", not guilt language
 * like "overdue/missed"; the accent dot carries the timeliness without a nagging
 * badge.
 */
function DueChip({ dueState, dueLabel }: { dueState: FollowupDueState; dueLabel: string }) {
  if (dueState === "upcoming") {
    return (
      <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
        Due {dueLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {dueState === "overdue" ? `Was due ${dueLabel}` : "Due today"}
    </span>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <p className="text-[length:var(--text-small)] text-destructive" role="alert">
      {message}
    </p>
  );
}

function ActiveFollowupRow({
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
        <DueChip dueLabel={followup.dueLabel} dueState={followup.dueState} />
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

function ResolvedFollowupRow({
  followup,
  onResolve,
  onReopen,
}: {
  followup: FollowupView;
  onResolve: (id: string) => void;
  onReopen: (view: FollowupView) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleReopen() {
    setError(null);
    startTransition(async () => {
      try {
        const reopened = await reopenFollowupAction({ followupId: followup.id });
        setLeaving(true);
        window.setTimeout(() => {
          onResolve(followup.id);
          // Reopened reminders are active again, so they rejoin the active list.
          onReopen(reopened);
        }, 200);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function handleArchive() {
    setError(null);
    startTransition(async () => {
      try {
        await archiveFollowupAction({ followupId: followup.id });
        setLeaving(true);
        window.setTimeout(() => onResolve(followup.id), 200);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <article
      className="flex flex-col gap-1.5 px-4 py-3 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={leaving}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-[52ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {followup.reason}
        </p>
        <span className="text-[length:var(--text-caption)] text-muted-foreground">
          {RESOLVED_STATUS_LABEL[followup.status] ?? followup.status}
        </span>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button disabled={pending} onClick={handleReopen} size="sm" type="button" variant="ghost">
          <RotateCcwIcon />
          Reopen
        </Button>
        <Button
          aria-label="Archive follow-up"
          disabled={pending}
          onClick={handleArchive}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ArchiveIcon />
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </article>
  );
}

function CreateFollowupForm({
  personId,
  firstName,
  defaultDueDate,
  onCreate,
}: {
  personId: string;
  firstName: string;
  defaultDueDate: string;
  onCreate: (view: FollowupView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmedReason = reason.trim();

  function reset() {
    setReason("");
    setDueDate(defaultDueDate);
    setError(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <Button
        className="self-start"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <PlusIcon />
        New follow-up
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2.5 rounded-xl border border-dashed bg-surface px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmedReason || !dueDate) {
          return;
        }
        setError(null);
        startTransition(async () => {
          try {
            const created = await createFollowupAction({
              personId,
              reason: trimmedReason,
              dueAt: dueDate,
            });
            onCreate(created);
            reset();
          } catch {
            setError(GENERIC_ERROR);
          }
        });
      }}
    >
      <Input
        aria-label={`Why follow up with ${firstName}?`}
        autoFocus
        onChange={(event) => setReason(event.target.value)}
        placeholder={`Why follow up with ${firstName}?`}
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
          <Button onClick={reset} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending || !trimmedReason || !dueDate} size="sm" type="submit">
            Add follow-up
          </Button>
        </div>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}

/**
 * The person profile's active follow-up management surface (issue #44). Active
 * reminders (open/snoozed) lead; a quiet "Resolved" list keeps recently done or
 * dismissed reminders reachable for reopen without becoming a task inbox. Every
 * mutation flows through the shared owner-scoped lifecycle via server actions.
 * Suggested follow-ups are not shown here — they stay in review surfaces until
 * accepted (#47/#48).
 */
export function PersonFollowups({
  personId,
  firstName,
  defaultDueDate,
  active,
  resolved,
}: {
  personId: string;
  firstName: string;
  defaultDueDate: string;
  active: FollowupView[];
  resolved: FollowupView[];
}) {
  const [activeList, setActiveList] = useState(active);
  const [resolvedList, setResolvedList] = useState(resolved);

  function removeActive(id: string) {
    setActiveList((current) => current.filter((followup) => followup.id !== id));
  }

  function updateActive(view: FollowupView) {
    setActiveList((current) =>
      sortByDue(current.map((followup) => (followup.id === view.id ? view : followup))),
    );
  }

  function addActive(view: FollowupView) {
    setActiveList((current) => sortByDue([...current, view]));
  }

  function removeResolved(id: string) {
    setResolvedList((current) => current.filter((followup) => followup.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      {activeList.length ? (
        <LedgerList>
          {activeList.map((followup) => (
            <ActiveFollowupRow
              followup={followup}
              key={followup.id}
              onResolve={removeActive}
              onUpdate={updateActive}
            />
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>
          No active follow-ups. Set a reminder to reconnect with {firstName}.
        </LedgerEmpty>
      )}

      <CreateFollowupForm
        defaultDueDate={defaultDueDate}
        firstName={firstName}
        onCreate={addActive}
        personId={personId}
      />

      {resolvedList.length ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground">
            Resolved ({resolvedList.length})
          </summary>
          <div className="mt-2">
            <LedgerList>
              {resolvedList.map((followup) => (
                <ResolvedFollowupRow
                  followup={followup}
                  key={followup.id}
                  onReopen={addActive}
                  onResolve={removeResolved}
                />
              ))}
            </LedgerList>
          </div>
        </details>
      ) : null}
    </div>
  );
}
