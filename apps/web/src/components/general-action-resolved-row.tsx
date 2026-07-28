"use client";

import { useState } from "react";
import { ActionRowControls } from "@/components/general-action-row-controls";
import { RotateCcwIcon } from "@/components/icons";
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
  onMutationFinalize,
  onUpdate,
}: {
  action: GeneralActionView;
  onMutationFinalize?: (id: string) => void;
  onUpdate: (action: GeneralActionView, phase?: ReversibleMutationApplyPhase) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const reopen = useReversibleMutation(action.id, "reopen");
  const archive = useReversibleMutation(action.id, "archive");
  const activeMutation = useActiveReversibleMutation(action.id, GENERAL_ACTION_MUTATION_INTENTS);
  const pending = Boolean(activeMutation?.state.pending);

  function run(intent: "reopen" | "archive", focusTarget: HTMLElement) {
    // fallow-ignore-next-line code-duplication -- Paused and resolved rows intentionally expose the same lifecycle contract while preserving distinct row semantics and controls.
    const mutation = intent === "reopen" ? reopen : archive;
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
    // Deep-link target (`/actions#action-<id>`), like the active rows: an asset
    // profile's related-actions list can land on a resolved row too (#199).
    // tabIndex lets the highlight move focus here so the jump is announced.
    <article
      aria-busy={pending}
      className={`flex scroll-mt-24 flex-col gap-2 px-4 py-3 transition-[opacity,transform] duration-200 ${activeMutation?.state.leaving ? "translate-y-0.5 opacity-70" : ""}`}
      data-leaving={activeMutation?.state.leaving ?? false}
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
        archiveBusy={archive.state.pending}
        error={activeMutation?.state.error ?? null}
        historyOpen={historyOpen}
        onArchive={(control) => run("archive", control)}
        onHistoryOpenChange={setHistoryOpen}
        pending={pending}
      >
        <Button
          disabled={pending}
          data-action-control="reopen"
          onClick={(event) => run("reopen", event.currentTarget)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {reopen.state.pending ? <Spinner /> : <RotateCcwIcon />}
          Reopen
        </Button>
        {activeMutation?.state.undoAvailable ? (
          <Button
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
