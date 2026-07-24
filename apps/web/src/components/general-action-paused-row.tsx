"use client";

import {
  ActionRowControls,
  useActionRowTransition,
} from "@/components/general-action-row-controls";
import { ActionRoutineChip } from "@/components/general-action-shared";
import { PlayIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
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
  onArchive,
}: {
  action: GeneralActionView;
  onResume: (action: GeneralActionView) => void;
  onArchive: (action: GeneralActionView) => void;
}) {
  const { historyOpen, setHistoryOpen } = useActionRowTransition();

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
        archiveBusy={false}
        error={null}
        historyOpen={historyOpen}
        onArchive={() => onArchive(action)}
        onHistoryOpenChange={setHistoryOpen}
        pending={false}
      >
        <Button
          disabled={false}
          data-action-control="resume"
          onClick={() => onResume(action)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PlayIcon />
          Resume
        </Button>
      </ActionRowControls>
    </article>
  );
}
