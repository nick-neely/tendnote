"use client";

import { useState } from "react";
import { ActionRowControls } from "@/components/general-action-row-controls";
import { ACTION_CONTROL_TOUCH_TARGET, ActionRoutineChip } from "@/components/general-action-shared";
import { PlayIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  GENERAL_ACTION_MUTATION_INTENTS,
  generalActionLifecycleAdapter,
  generalActionLifecycleCommand,
  generalActionMutationLabels,
} from "@/lib/general-action-reversible-mutation";
import type { GeneralActionView } from "@/lib/general-action-view";
import {
  type ReversibleMutationApplyPhase,
  useActiveReversibleMutation,
  useReversibleMutation,
} from "@/lib/reversible-mutation";

/**
 * A paused Routine, kept quietly reachable so it can be resumed or retired. Resume
 * returns it to the active list under its cadence; archive removes it while preserving
 * history. A paused Routine is deliberately calm — it names its rhythm, never a missed
 * count (ADR 0148; calm register).
 */
export function PausedRoutineRow({
  action,
  onMutationFinalize,
  onUpdate,
}: {
  action: GeneralActionView;
  onMutationFinalize?: (id: string) => void;
  onUpdate: (action: GeneralActionView, phase?: ReversibleMutationApplyPhase) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const resume = useReversibleMutation(action.id, "resume");
  const archive = useReversibleMutation(action.id, "archive");
  const activeMutation = useActiveReversibleMutation(action.id, GENERAL_ACTION_MUTATION_INTENTS);
  const pending = Boolean(activeMutation?.state.pending);

  function run(intent: "resume" | "archive", focusTarget: HTMLElement) {
    // fallow-ignore-next-line code-duplication -- Paused and resolved rows intentionally expose the same lifecycle contract while preserving distinct row semantics and controls.
    const mutation = intent === "resume" ? resume : archive;
    mutation.run({
      kind: "optimistic",
      adapter: generalActionLifecycleAdapter(intent),
      apply: onUpdate,
      command: () => generalActionLifecycleCommand(intent, action.id),
      focusTarget,
      labels: generalActionMutationLabels(intent),
      onFinalize: () => onMutationFinalize?.(action.id),
      prior: action,
      ...(intent === "archive" ? { leave: { apply: onUpdate } } : {}),
    });
  }

  return (
    // Deep-link target (`/actions#action-<id>`): a paused Routine can be linked
    // from an asset profile's related actions, so it anchors like every row (#199).
    <article
      aria-busy={pending}
      className={`flex scroll-mt-24 flex-col gap-2 px-4 py-3 transition-[opacity,transform] duration-200 ${activeMutation?.state.leaving ? "translate-y-0.5 opacity-70" : ""}`}
      data-leaving={activeMutation?.state.leaving ?? false}
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
        archiveBusy={archive.state.pending}
        error={activeMutation?.state.error ?? null}
        historyOpen={historyOpen}
        onArchive={(control) => run("archive", control)}
        onHistoryOpenChange={setHistoryOpen}
        pending={pending}
      >
        <Button
          className={ACTION_CONTROL_TOUCH_TARGET}
          disabled={pending}
          data-action-control="resume"
          onClick={(event) => run("resume", event.currentTarget)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {resume.state.pending ? <Spinner /> : <PlayIcon />}
          Resume
        </Button>
        {activeMutation?.state.undoAvailable ? (
          <Button
            className={ACTION_CONTROL_TOUCH_TARGET}
            disabled={activeMutation.state.undoRequested}
            onClick={activeMutation.requestUndo}
            size="sm"
            type="button"
            variant="outline"
          >
            {activeMutation.state.undoRequested ? <Spinner aria-hidden /> : null}
            {activeMutation.state.undoRequested ? "Undoing…" : activeMutation.state.labels.undo}
          </Button>
        ) : null}
      </ActionRowControls>
    </article>
  );
}
