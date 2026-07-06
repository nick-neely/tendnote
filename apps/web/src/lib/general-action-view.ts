import type {
  GeneralActionAssetHint,
  GeneralActionEvent,
  GeneralActionEventKind,
  GeneralActionLink,
  GeneralActionStatus,
  PrivacyScope,
} from "@tendnote/domain";
import { visibilityLabelForScope } from "@tendnote/domain/privacy";
import { toDateInputValue } from "@/lib/followup-view";

/** A linked person named for a calm chip — id + display name, nothing more (ADR 0155). */
export type GeneralActionPersonView = { id: string; displayName: string };

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
  /** Lightweight object/asset hints (subject labels), never durable records (ADR 0156). */
  assetHints: GeneralActionAssetHint[];
  /** People linked as context — never a Follow-Up conversion (ADR 0155). */
  linkedPeople: GeneralActionPersonView[];
  status: GeneralActionStatus;
  /** Visibility scope (ADR 0153). Drives the calm scope indicator; private stays bare. */
  scope: PrivacyScope;
  /**
   * A calm scope label that says *who*, not just that it's shared — "Only me",
   * "Specific people · 2", or the household's name (falling back to "Whole
   * household"). So an owner can read the audience off the chip without opening the
   * editor.
   */
  visibilityLabel: string;
  /**
   * Whether the viewing user owns this Action. Only the owner may edit content or
   * re-scope; a household member who can see a shared/household Action may still act
   * on it (complete, set aside, dismiss, archive) (ADR 0153).
   */
  owned: boolean;
  /** The Action's owner, so a non-owner row can name who shared it (a co-member). */
  ownerUserId: string;
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
 * The scope label for the calm visibility chip, resolved to say *who* rather than
 * just the scope name: a member count for a selected-shared Action, the household's
 * name for a household one (both fall back to the plain scope label). Private returns
 * "Only me" but the surface never renders a chip for it.
 */
function scopeAudienceLabel(action: {
  scope: PrivacyScope;
  sharedWithCount: number;
  householdName: string | null;
}): string {
  if (action.scope === "shared") {
    const base = visibilityLabelForScope("shared");
    return action.sharedWithCount > 0 ? `${base} · ${action.sharedWithCount}` : base;
  }
  if (action.scope === "household") {
    return action.householdName ?? visibilityLabelForScope("household");
  }
  return visibilityLabelForScope("private");
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
    assetHints: GeneralActionAssetHint[];
    linkedPeople: GeneralActionPersonView[];
    status: GeneralActionStatus;
    scope: PrivacyScope;
    ownerUserId: string;
    /** How many members a `shared` Action reaches; 0 otherwise. */
    sharedWithCount: number;
    /** The household's name for a `shared`/`household` Action, when one exists. */
    householdName: string | null;
    dueAt: Date | null;
    deferUntil: Date | null;
    areaId: string | null;
  },
  options: { now?: Date; callerUserId: string },
): GeneralActionView {
  const now = options.now ?? new Date();
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
    assetHints: action.assetHints,
    linkedPeople: action.linkedPeople,
    status: action.status,
    scope: action.scope,
    visibilityLabel: scopeAudienceLabel(action),
    owned: action.ownerUserId === options.callerUserId,
    ownerUserId: action.ownerUserId,
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
