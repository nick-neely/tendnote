"use client";

import { ActionHistoryDialog } from "@/components/general-action-history-dialog";
import { ErrorText } from "@/components/general-action-shared";
import { ArchiveIcon, HistoryIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GeneralActionView } from "@/lib/general-action-view";

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
  onArchive: (initiatingControl: HTMLElement) => void;
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
        <Button
          data-action-control="archive"
          disabled={pending}
          onClick={(event) => onArchive(event.currentTarget)}
          size="sm"
          type="button"
          variant="ghost"
        >
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
