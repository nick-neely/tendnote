import { archiveFollowupAction, reopenFollowupAction } from "@/app/actions/followups";
import { ArchiveIcon, RotateCcwIcon } from "@/components/icons";
import { ErrorText } from "@/components/person-followup-shared";
import { Button } from "@/components/ui/button";
import { followupLifecycleAdapter } from "@/lib/followup-reversible-mutation";
import type { FollowupView } from "@/lib/followup-view";
import {
  type ReversibleMutationApplyPhase,
  type ReversibleMutationApplyResult,
  useActiveReversibleMutation,
  useReversibleMutation,
} from "@/lib/reversible-mutation";

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
  onMutationFinalize,
  onUpdate,
}: {
  followup: FollowupView;
  onMutationFinalize?: (id: string) => void;
  onUpdate: (
    view: FollowupView,
    phase?: ReversibleMutationApplyPhase,
  ) => ReversibleMutationApplyResult;
}) {
  const reopen = useReversibleMutation(followup.id, "reopen");
  const archive = useReversibleMutation(followup.id, "archive");
  const active = useActiveReversibleMutation(followup.id, ["reopen", "archive"]);
  const pending = Boolean(active?.state.pending);

  function handleReopen(focusTarget: HTMLElement) {
    reopen.run({
      kind: "optimistic",
      adapter: followupLifecycleAdapter("reopen"),
      apply: onUpdate,
      command: () => reopenFollowupAction({ followupId: followup.id }),
      focusTarget,
      labels: {
        pending: "Reopening follow-up…",
        success: "Follow-up reopened. Undo available.",
        rollback: "The follow-up returned to Resolved after reopen failed.",
        undo: "Undo Reopen",
        undone: "Follow-up restored.",
      },
      onFinalize: () => onMutationFinalize?.(followup.id),
      prior: followup,
    });
  }

  function handleArchive(focusTarget: HTMLElement) {
    archive.run({
      kind: "optimistic",
      adapter: followupLifecycleAdapter("archive"),
      apply: onUpdate,
      command: () => archiveFollowupAction({ followupId: followup.id }),
      failureAnnouncement: "assertive",
      focusTarget,
      labels: {
        pending: "Archiving follow-up…",
        success: "Follow-up archived. Undo available.",
        rollback: "The follow-up was restored after archive failed.",
        undo: "Undo Archive",
        undone: "Follow-up restored.",
      },
      leave: { apply: onUpdate },
      onFinalize: () => onMutationFinalize?.(followup.id),
      prior: followup,
    });
  }

  return (
    <article
      className="scroll-mt-40 flex flex-col gap-1.5 px-4 py-3 transition-[opacity,transform] duration-200 ease-(--motion-ease-out) focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[leaving=true]:translate-y-0.5 data-[leaving=true]:opacity-0 motion-reduce:transition-none"
      data-leaving={active?.state.leaving ?? false}
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
        {active?.state.undoAvailable ? (
          <Button
            disabled={active.state.undoRequested}
            onClick={active.requestUndo}
            size="sm"
            type="button"
            variant="outline"
          >
            {active.state.undoRequested ? "Undoing…" : active.state.labels.undo}
          </Button>
        ) : null}
        <Button
          disabled={pending}
          onClick={(event) => handleReopen(event.currentTarget)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RotateCcwIcon />
          Reopen
        </Button>
        <Button
          aria-label="Archive follow-up"
          disabled={pending}
          onClick={(event) => handleArchive(event.currentTarget)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ArchiveIcon />
        </Button>
      </div>
      {active?.state.error ? <ErrorText message={active.state.error} /> : null}
    </article>
  );
}
