"use client";

import { ArchiveIcon, HistoryIcon, RotateCcwIcon } from "lucide-react";
import { useState, useTransition } from "react";
import {
  archiveGeneralActionAction,
  reopenGeneralActionAction,
} from "@/app/actions/general-actions";
import { ActionHistoryDialog } from "@/components/general-action-history-dialog";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GeneralActionMutationResult, GeneralActionView } from "@/lib/general-action-view";

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<"reopen" | "archive" | null>(null);
  const [pending, startTransition] = useTransition();

  function run(kind: "reopen" | "archive", action_: () => Promise<GeneralActionMutationResult>) {
    setError(null);
    setBusyKey(kind);
    startTransition(async () => {
      try {
        const result = await action_();
        if (!result.ok) {
          setError(result.error);
          setBusyKey(null);
          return;
        }
        if (kind === "reopen") {
          onReopen(result.view);
        } else {
          onResolve(action.id);
        }
      } catch {
        setError(GENERIC_ERROR);
        setBusyKey(null);
      }
    });
  }

  return (
    <article className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-[60ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {action.title}
        </p>
        <span className="shrink-0 font-mono text-[length:var(--text-caption)] text-muted-foreground">
          {RESOLVED_LABEL[action.status] ?? action.status}
        </span>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          disabled={pending}
          onClick={() => setHistoryOpen(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <HistoryIcon />
          History
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            run("reopen", () => reopenGeneralActionAction({ generalActionId: action.id }))
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          {busyKey === "reopen" ? <Spinner /> : <RotateCcwIcon />}
          Reopen
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            run("archive", () => archiveGeneralActionAction({ generalActionId: action.id }))
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          {busyKey === "archive" ? <Spinner /> : <ArchiveIcon />}
          Archive
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
      <ActionHistoryDialog
        generalActionId={action.id}
        onOpenChange={setHistoryOpen}
        open={historyOpen}
        title={action.title}
      />
    </article>
  );
}
