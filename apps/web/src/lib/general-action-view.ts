import type {
  GeneralActionEvent,
  GeneralActionEventKind,
  GeneralActionLink,
  GeneralActionStatus,
} from "@tendnote/domain";
import { toDateInputValue } from "@/lib/followup-view";

/**
 * Where an Action sits in time, so the calm Actions surface can gently flag what's
 * due without task-manager urgency. `unscheduled` and `deferred` are first-class:
 * an Action need not have a date, and a deferred one is deliberately set aside
 * (DESIGN.md §3; ADR 0149). Never red, never "overdue/missed" language.
 */
export type ActionSurfaceState = "overdue" | "today" | "upcoming" | "unscheduled" | "deferred";

/**
 * Result of a General Action mutation server action. Validation failures (a bad
 * link URL, an invalid transition) return `{ ok: false, error }` with a curated,
 * user-safe message so the surface can show a field-level signal instead of
 * swallowing it; unexpected/infra failures reject instead, and the client shows a
 * generic fallback.
 */
export type GeneralActionMutationResult =
  | { ok: true; view: GeneralActionView }
  | { ok: false; error: string };

export type GeneralActionView = {
  id: string;
  title: string;
  notes: string | null;
  links: GeneralActionLink[];
  status: GeneralActionStatus;
  /** The Action's primary Area, or null when unfiled. Name resolves in the surface. */
  areaId: string | null;
  /** ISO due timestamp, or null when unscheduled. */
  dueAtISO: string | null;
  /** `YYYY-MM-DD` for a date input's default value; empty when unscheduled. */
  dueAtDate: string;
  deferUntilISO: string | null;
  deferUntilDate: string;
  surfaceState: ActionSurfaceState;
  /** A calm, human timeliness label (e.g. "Due Jul 12", "Set aside until Aug 1"). */
  surfaceLabel: string;
};

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatDay(date: Date, now: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function dueState(dueAt: Date, now: Date): "overdue" | "today" | "upcoming" {
  const due = startOfDay(dueAt);
  const today = startOfDay(now);
  if (due < today) {
    return "overdue";
  }
  if (due === today) {
    return "today";
  }
  return "upcoming";
}

/**
 * Maps a persisted General Action to a serializable view for client components.
 * Dates are pre-resolved server-side (label + date-input value) so the client
 * never re-derives timezones, matching the Follow-Up view seam.
 */
export function toGeneralActionView(
  action: {
    id: string;
    title: string;
    notes: string | null;
    links: GeneralActionLink[];
    status: GeneralActionStatus;
    dueAt: Date | null;
    deferUntil: Date | null;
    areaId: string | null;
  },
  now: Date = new Date(),
): GeneralActionView {
  let surfaceState: ActionSurfaceState;
  let surfaceLabel: string;

  if (action.status === "deferred" && action.deferUntil) {
    surfaceState = "deferred";
    surfaceLabel = `Set aside until ${formatDay(action.deferUntil, now)}`;
  } else if (action.dueAt) {
    surfaceState = dueState(action.dueAt, now);
    const day = formatDay(action.dueAt, now);
    surfaceLabel =
      surfaceState === "overdue"
        ? `Was due ${day}`
        : surfaceState === "today"
          ? "Due today"
          : `Due ${day}`;
  } else {
    surfaceState = "unscheduled";
    surfaceLabel = "No date";
  }

  return {
    id: action.id,
    title: action.title,
    notes: action.notes,
    links: action.links,
    status: action.status,
    areaId: action.areaId,
    dueAtISO: action.dueAt?.toISOString() ?? null,
    dueAtDate: action.dueAt ? toDateInputValue(action.dueAt) : "",
    deferUntilISO: action.deferUntil?.toISOString() ?? null,
    deferUntilDate: action.deferUntil ? toDateInputValue(action.deferUntil) : "",
    surfaceState,
    surfaceLabel,
  };
}

const EVENT_LABELS: Record<GeneralActionEventKind, string> = {
  created: "Created",
  edited: "Edited",
  completed: "Completed",
  reopened: "Reopened",
  deferred: "Set aside",
  dismissed: "Dismissed",
  archived: "Archived",
};

export type GeneralActionEventView = {
  id: string;
  kind: GeneralActionEventKind;
  label: string;
  atISO: string;
  atLabel: string;
};

/**
 * Maps a lifecycle event to a serializable history-row view. History explains what
 * happened and when — plain and calm, without productivity analytics (ADR 0165).
 */
export function toGeneralActionEventView(
  event: Pick<GeneralActionEvent, "id" | "kind" | "detailJson" | "createdAt">,
  now: Date = new Date(),
): GeneralActionEventView {
  let label = EVENT_LABELS[event.kind];
  const deferUntil = event.detailJson?.deferUntil;
  if (event.kind === "deferred" && typeof deferUntil === "string") {
    const date = new Date(deferUntil);
    if (!Number.isNaN(date.getTime())) {
      label = `Set aside until ${formatDay(date, now)}`;
    }
  }

  return {
    id: event.id,
    kind: event.kind,
    label,
    atISO: event.createdAt.toISOString(),
    atLabel: event.createdAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: event.createdAt.getFullYear() === now.getFullYear() ? undefined : "numeric",
    }),
  };
}
