"use client";

import { PlayIcon } from "lucide-react";
import {
  archiveGeneralActionAction,
  resumeGeneralActionAction,
} from "@/app/actions/general-actions";
import {
  ActionRowControls,
  useActionRowTransition,
} from "@/components/general-action-row-controls";
import { ActionRoutineChip } from "@/components/general-action-shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { GeneralActionView } from "@/lib/general-action-view";

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
  const { historyOpen, setHistoryOpen, error, busyKey, pending, run } = useActionRowTransition();

  return (
    // Deep-link target (`/actions#action-<id>`): a paused Routine can be linked
    // from an asset profile's related actions, so it anchors like every row (#199).
    <article
      className="flex scroll-mt-24 flex-col gap-2 px-4 py-3"
      id={`action-${action.id}`}
      tabIndex={-1}
    >
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
              "resume",
              () => resumeGeneralActionAction({ generalActionId: action.id }),
              (view) => onResume(view),
            )
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          {busyKey === "resume" ? <Spinner /> : <PlayIcon />}
          Resume
        </Button>
      </ActionRowControls>
    </article>
  );
}
