"use client";

import { useState, useTransition } from "react";
import { ActionHistoryDialog } from "@/components/general-action-history-dialog";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { ArchiveIcon, HistoryIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GeneralActionMutationResult, GeneralActionView } from "@/lib/general-action-view";

/**
 * The shared lifecycle machinery for the calm "kept reachable" Action rows (paused
 * Routines, resolved Actions): one busy key at a time, an inline error on failure, and a
 * history dialog toggle. On success the caller navigates the row out of its list, so the
 * busy key is deliberately left set (the spinner holds until unmount) — only a failure
 * clears it. Each row supplies its own success handler because the destination differs
 * (resume/reopen return a view; archive resolves by id).
 */
export function useActionRowTransition() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    kind: string,
    mutate: () => Promise<GeneralActionMutationResult>,
    onSuccess: (view: GeneralActionView) => void,
  ) {
    setError(null);
    setBusyKey(kind);
    startTransition(async () => {
      try {
        const result = await mutate();
        if (!result.ok) {
          setError(result.error);
          setBusyKey(null);
          return;
        }
        onSuccess(result.view);
      } catch {
        setError(GENERIC_ERROR);
        setBusyKey(null);
      }
    });
  }

  return { historyOpen, setHistoryOpen, error, busyKey, pending, run };
}

/**
 * The shared control bar for a kept-reachable Action row: a History button, a row-specific
 * primary action (passed as `children`, e.g. Resume or Reopen), and an Archive button, plus
 * the inline error line and the history dialog. Keeps the two rows' calm footer identical.
 */
export function ActionRowControls({
  action,
  pending,
  error,
  historyOpen,
  onHistoryOpenChange,
  onArchive,
  archiveBusy,
  children,
}: {
  action: GeneralActionView;
  pending: boolean;
  error: string | null;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  onArchive: () => void;
  archiveBusy: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          disabled={pending}
          onClick={() => onHistoryOpenChange(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <HistoryIcon />
          History
        </Button>
        {children}
        <Button disabled={pending} onClick={onArchive} size="sm" type="button" variant="ghost">
          {archiveBusy ? <Spinner /> : <ArchiveIcon />}
          Archive
        </Button>
      </div>
      {error ? <ErrorText message={error} /> : null}
      <ActionHistoryDialog
        generalActionId={action.id}
        onOpenChange={onHistoryOpenChange}
        open={historyOpen}
        title={action.title}
      />
    </>
  );
}
