"use client";

import { RotateCcwIcon } from "lucide-react";
import {
  archiveGeneralActionAction,
  reopenGeneralActionAction,
} from "@/app/actions/general-actions";
import {
  ActionRowControls,
  useActionRowTransition,
} from "@/components/general-action-row-controls";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GeneralActionView } from "@/lib/general-action-view";

const RESOLVED_LABEL: Record<string, string> = {
  completed: "Completed",
  dismissed: "Dismissed",
};

/**
 * A resolved (completed or dismissed) Action, kept quietly reachable so it can be
 * reopened or archived without becoming a task inbox. Reopen returns it to the
 * active list; archive removes it from view while preserving history.
 */
export function ResolvedActionRow({
  action,
  onReopen,
  onResolve,
}: {
  action: GeneralActionView;
  onReopen: (view: GeneralActionView) => void;
  onResolve: (id: string) => void;
}) {
  const { historyOpen, setHistoryOpen, error, busyKey, pending, run } = useActionRowTransition();

  return (
    // Deep-link target (`/actions#action-<id>`), like the active rows: an asset
    // profile's related-actions list can land on a resolved row too (#199).
    // tabIndex lets the highlight move focus here so the jump is announced.
    <article
      className="flex scroll-mt-24 flex-col gap-2 px-4 py-3"
      id={`action-${action.id}`}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-[60ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {action.title}
        </p>
        <span className="shrink-0 font-mono text-[length:var(--text-caption)] text-muted-foreground">
          {RESOLVED_LABEL[action.status] ?? action.status}
        </span>
      </div>
      <ActionRowControls
        action={action}
        archiveBusy={busyKey === "archive"}
        error={error}
        historyOpen={historyOpen}
        onArchive={() =>
          run(
            "archive",
            () => archiveGeneralActionAction({ generalActionId: action.id }),
            () => onResolve(action.id),
          )
        }
        onHistoryOpenChange={setHistoryOpen}
        pending={pending}
      >
        <Button
          disabled={pending}
          onClick={() =>
            run(
              "reopen",
              () => reopenGeneralActionAction({ generalActionId: action.id }),
              (view) => onReopen(view),
            )
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          {busyKey === "reopen" ? <Spinner /> : <RotateCcwIcon />}
          Reopen
        </Button>
      </ActionRowControls>
    </article>
  );
}
