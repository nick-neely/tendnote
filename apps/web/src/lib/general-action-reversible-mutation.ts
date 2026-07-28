import {
  archiveGeneralActionAction,
  completeGeneralActionAction,
  deferGeneralActionAction,
  dismissGeneralActionAction,
  pauseGeneralActionAction,
  reopenGeneralActionAction,
  restoreGeneralActionAction,
  resumeGeneralActionAction,
  undeferGeneralActionAction,
  undoRoutineOccurrenceAction,
} from "@/app/actions/general-actions";
import type { GeneralActionView } from "@/lib/general-action-view";
import type {
  ReversibleMutationAdapter,
  ReversibleMutationLabels,
} from "@/lib/reversible-mutation";

export const GENERAL_ACTION_MUTATION_INTENTS = [
  "complete",
  "dismiss",
  "archive",
  "pause",
  "defer",
  "routine-complete",
  "routine-skip",
  "reopen",
  "resume",
  "edit",
  "share",
] as const;

type LifecycleIntent = "complete" | "dismiss" | "archive" | "pause" | "reopen" | "resume";
type MutationLabelIntent = LifecycleIntent | "defer" | "routine-complete" | "routine-skip";

const LABEL: Record<MutationLabelIntent, string> = {
  complete: "Complete",
  dismiss: "Dismiss",
  archive: "Archive",
  pause: "Pause",
  reopen: "Reopen",
  resume: "Resume",
  defer: "Set aside",
  "routine-complete": "Complete",
  "routine-skip": "Skip",
};

const PAST: Record<MutationLabelIntent, string> = {
  archive: "archived",
  complete: "completed",
  defer: "set aside",
  dismiss: "dismissed",
  pause: "paused",
  reopen: "reopened",
  resume: "resumed",
  "routine-complete": "completed",
  "routine-skip": "skipped",
};

const PENDING: Partial<Record<MutationLabelIntent, string>> = {
  defer: "Setting action aside…",
  reopen: "Reopening action…",
  resume: "Resuming action…",
};

export function generalActionMutationLabels(intent: MutationLabelIntent): ReversibleMutationLabels {
  const label = LABEL[intent];
  const past = PAST[intent];
  return {
    pending: PENDING[intent] ?? "Updating action…",
    success: `${past.charAt(0).toUpperCase()}${past.slice(1)}. Undo available.`,
    rollback: `The action was restored after ${label.toLowerCase()} failed.`,
    undo: label === "Set aside" ? "Undo set aside" : `Undo ${label}`,
    undone: "Action restored.",
  };
}

function projectLifecycle(intent: LifecycleIntent, prior: GeneralActionView): GeneralActionView {
  switch (intent) {
    case "reopen":
      return { ...prior, status: "open", surfaceLabel: "Reopening…" };
    case "resume":
      return { ...prior, status: "open", surfaceLabel: "Resuming…" };
    default:
      // Terminal and pause mutations stay in their current list for the module's
      // owned leave interval. `state.leaving` acknowledges the projected intent.
      return prior;
  }
}

function inverseLifecycle(intent: LifecycleIntent, prior: GeneralActionView) {
  switch (intent) {
    case "complete":
    case "dismiss":
      return () => reopenGeneralActionAction({ generalActionId: prior.id });
    case "archive":
      return () => restoreGeneralActionAction({ generalActionId: prior.id });
    case "pause":
      return () => resumeGeneralActionAction({ generalActionId: prior.id });
    case "resume":
      return () => pauseGeneralActionAction({ generalActionId: prior.id });
    case "reopen":
      return prior.status === "dismissed"
        ? () => dismissGeneralActionAction({ generalActionId: prior.id })
        : () => completeGeneralActionAction({ generalActionId: prior.id });
  }
}

export function generalActionLifecycleAdapter(
  intent: LifecycleIntent,
): ReversibleMutationAdapter<GeneralActionView> {
  return {
    project: (prior) => projectLifecycle(intent, prior),
    inverse: (prior) => inverseLifecycle(intent, prior)(),
  };
}

export function generalActionLifecycleCommand(intent: LifecycleIntent, generalActionId: string) {
  switch (intent) {
    case "complete":
      return completeGeneralActionAction({ generalActionId });
    case "dismiss":
      return dismissGeneralActionAction({ generalActionId });
    case "archive":
      return archiveGeneralActionAction({ generalActionId });
    case "pause":
      return pauseGeneralActionAction({ generalActionId });
    case "reopen":
      return reopenGeneralActionAction({ generalActionId });
    case "resume":
      return resumeGeneralActionAction({ generalActionId });
  }
}

export function generalActionDeferAdapter(
  deferDate: string,
  surfaceLabel: string,
): ReversibleMutationAdapter<GeneralActionView> {
  return {
    project: (prior) => ({
      ...prior,
      status: "deferred",
      deferUntilDate: deferDate,
      deferUntilISO: `${deferDate}T00:00:00.000Z`,
      surfaceState: "deferred",
      surfaceLabel,
    }),
    inverse: (prior) =>
      prior.status === "deferred" && prior.deferUntilDate
        ? deferGeneralActionAction({
            deferUntil: prior.deferUntilDate,
            generalActionId: prior.id,
          })
        : undeferGeneralActionAction({ generalActionId: prior.id }),
  };
}

export function routineOccurrenceInverse(
  prior: GeneralActionView,
): (authoritative: GeneralActionView) => ReturnType<typeof undoRoutineOccurrenceAction> {
  return (authoritative) => {
    if (!prior.dueAtISO || !authoritative.dueAtISO) {
      return Promise.resolve({
        ok: false,
        error: "The Routine does not have an occurrence date to restore.",
      });
    }
    return undoRoutineOccurrenceAction({
      expectedDueAt: authoritative.dueAtISO,
      generalActionId: prior.id,
      restoreDueAt: prior.dueAtISO,
    });
  };
}
