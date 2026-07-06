"use client";

import { ArchiveIcon, HistoryIcon, PlayIcon } from "lucide-react";
import { useState, useTransition } from "react";
import {
  archiveGeneralActionAction,
  resumeGeneralActionAction,
} from "@/app/actions/general-actions";
import { ActionHistoryDialog } from "@/components/general-action-history-dialog";
import { ActionRoutineChip, ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GeneralActionMutationResult, GeneralActionView } from "@/lib/general-action-view";

/**
 * A paused Routine, kept quietly reachable so it can be resumed or retired. Resume
 * returns it to the active list under its cadence; archive removes it while preserving
 * history. A paused Routine is deliberately calm — it names its rhythm, never a missed
 * count (ADR 0148; calm register).
 */
export function PausedRoutineRow({
  action,
  onResume,
  onResolve,
}: {
  action: GeneralActionView;
  onResume: (view: GeneralActionView) => void;
  onResolve: (id: string) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<"resume" | "archive" | null>(null);
  const [pending, startTransition] = useTransition();

  function run(kind: "resume" | "archive", mutate: () => Promise<GeneralActionMutationResult>) {
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
        if (kind === "resume") {
          onResume(result.view);
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
        <div className="grid gap-1.5">
          <p className="max-w-[60ch] text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            {action.title}
          </p>
          {action.recurrenceLabel ? <ActionRoutineChip label={action.recurrenceLabel} /> : null}
        </div>
        {/* Indefinite, not dated — the calm contrast with a deferred Action's "Set
            aside until <date>". A paused Routine waits for the owner, no clock. */}
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
            Paused
          </span>
          <span className="text-[length:var(--text-caption)] text-muted-foreground">
            Resume anytime
          </span>
        </div>
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
            run("resume", () => resumeGeneralActionAction({ generalActionId: action.id }))
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          {busyKey === "resume" ? <Spinner /> : <PlayIcon />}
          Resume
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
