import { useState, useTransition } from "react";
import { archiveFollowupAction, reopenFollowupAction } from "@/app/actions/followups";
import { ArchiveIcon, RotateCcwIcon } from "@/components/icons";
import { ErrorText, GENERIC_ERROR } from "@/components/person-followup-shared";
import { Button } from "@/components/ui/button";
import type { FollowupView } from "@/lib/followup-view";

const RESOLVED_STATUS_LABEL: Record<string, string> = {
  completed: "Done",
  dismissed: "Dismissed",
};

/**
 * A resolved (completed or dismissed) reminder row, kept reachable for reopen or
 * archive without becoming a task inbox. Reopening rejoins the active list; both
 * actions animate the row out before the parent drops it.
 */
export function ResolvedFollowupRow({
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
      className="scroll-mt-40 flex flex-col gap-1.5 px-4 py-3 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={leaving}
      id={`followup-${followup.id}`}
      tabIndex={-1}
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
