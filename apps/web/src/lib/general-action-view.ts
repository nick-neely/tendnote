import type { GeneralActionLinkedAsset } from "@tendnote/db/queries/assets";
import type {
  AssetKind,
  GeneralActionAssetHint,
  GeneralActionEvent,
  GeneralActionEventKind,
  GeneralActionLink,
  GeneralActionOwnership,
  GeneralActionRecurrence,
  GeneralActionStatus,
  PrivacyScope,
  RecordSurfacingState,
} from "@tendnote/domain";
import { assetLabelForKind } from "@tendnote/domain/assets";
import { describeRecurrence } from "@tendnote/domain/general-actions";
import { responsibilityHolderLabel } from "@tendnote/domain/household-actions";
import {
  formatSurfacingDay,
  resolveRecordSurfacing,
  resolveRecordTiming,
} from "@tendnote/domain/record-surfacing";
import { toDateInputValue } from "@/lib/followup-view";
import type { OwnerActionResult } from "@/lib/owner-action";
import { type ReminderScheduleView, toReminderScheduleView } from "@/lib/reminder-schedule-view";

/** A linked person named for a calm chip — id + display name, nothing more (ADR 0155). */
export type GeneralActionPersonView = { id: string; displayName: string };

/**
 * A linked Asset named for the action's context strip (#199): a real record the
 * chip can deep-link to, unlike a bare hint label. `pending` marks a promotion
 * still waiting in review (owner-only) — shown as a quiet in-review state, never
 * a navigable Asset.
 */
export type GeneralActionLinkedAssetView = {
  assetId: string;
  name: string;
  kind: AssetKind;
  kindLabel: string;
  /** The hint this link came from, so the strip can pair chip and hint. */
  hintLabel: string | null;
  pending: boolean;
};

/** Maps a bridge read entry to its serializable chip view. */
export function toGeneralActionLinkedAssetView(
  entry: GeneralActionLinkedAsset,
): GeneralActionLinkedAssetView {
  return {
    assetId: entry.asset.id,
    name: entry.asset.name,
    kind: entry.asset.kind,
    kindLabel: assetLabelForKind(entry.asset.kind),
    hintLabel: entry.hintLabel,
    pending: entry.pending,
  };
}

/**
 * Where an Action sits in time, so the calm Actions surface can gently flag what's
 * due without task-manager urgency. `unscheduled` and `deferred` are first-class:
 * an Action need not have a date, and a deferred one is deliberately set aside
 * (DESIGN.md §3; ADR 0149). Never red, never "overdue/missed" language.
 */
export type ActionSurfaceState = RecordSurfacingState;

/**
 * Result of a General Action mutation server action. Validation failures (a bad
 * link URL, an invalid transition) return `{ ok: false, error }` with a curated,
 * user-safe message so the surface can show a field-level signal instead of
 * swallowing it; unexpected/infra failures reject instead, and the client shows a
 * generic fallback.
 */
export type GeneralActionMutationResult = OwnerActionResult<GeneralActionView>;

/**
 * A progress mutation's result: the authoritative view, plus what happened when
 * the occurrence had already been settled by someone else.
 *
 * The view is *widened* rather than wrapped, mirroring the server outcome: every
 * surface that ignores `reconciliation` behaves exactly as it did before shared
 * Actions existed, and only the surfaces that can say something useful about a
 * race have to know a race is possible. `null` means the tap advanced the record
 * normally. Non-null is never an error — the member's report was truthful, it
 * simply arrived second (ADR 0214).
 */
export type GeneralActionProgressView = GeneralActionView & {
  reconciliation?: {
    handledAs: "completed" | "skipped";
    handledByUserId: string | null;
    handledByName: string | null;
    handledAtISO: string;
  } | null;
};

export type GeneralActionProgressResult = OwnerActionResult<GeneralActionProgressView>;

/**
 * What this viewer may do to this Action, decided once from its ownership form
 * and the viewer's relationship to it, so no surface has to re-derive the
 * Phase Eight authority table and get a row of it wrong.
 *
 * Completing and reopening are deliberately absent: they are the one pair any
 * member who can see a record may do, so a rendered row always offers them. What
 * this narrows is everything else — a member-owned Action shared into the
 * household stays its owner's to author, while a household-native one grants
 * every active member the same authority (ADRs 0214, 0215).
 */
export type GeneralActionAuthority = {
  /** Title, notes, due date, links, asset hints, recurrence, pause and resume. */
  edit: boolean;
  /** People links, which are one member's own records and never the household's. */
  people: boolean;
  /** "Not this time" — an authoring act on the shared occurrence, not a report. */
  skip: boolean;
  defer: boolean;
  /** Archive and dismiss, which are decisions rather than reversible progress. */
  archive: boolean;
  /** Name, change, or clear who is looking after this. */
  responsibility: boolean;
  /** Change visibility; a household-native record has no audience to change. */
  audience: boolean;
  /** The one-way, confirmed hand-over of a member-owned record to the household. */
  handToHousehold: boolean;
};

export function resolveGeneralActionAuthority(
  ownership: GeneralActionOwnership,
  owned: boolean,
): GeneralActionAuthority {
  // A household-native record is only ever projected for a member who can see it,
  // and it is visible to every active member by definition — so "can see it" is
  // "is an active member", which is the whole of its authority test (ADR 0214).
  const householdNative = ownership === "household_native";
  return {
    edit: householdNative || owned,
    people: !householdNative && owned,
    skip: householdNative || owned,
    defer: householdNative || owned,
    archive: householdNative || owned,
    responsibility: householdNative,
    audience: !householdNative && owned,
    handToHousehold: !householdNative && owned,
  };
}

export type GeneralActionView = {
  id: string;
  /** Durable server revision used to reject older Action projections after a write. */
  revision: string;
  title: string;
  notes: string | null;
  links: GeneralActionLink[];
  /** Lightweight object/asset hints (subject labels), never durable records (ADR 0156). */
  assetHints: GeneralActionAssetHint[];
  /** Assets this action is linked to — promoted hints, scope-filtered per viewer (#199). */
  linkedAssets: GeneralActionLinkedAssetView[];
  /** People linked as context — never a Follow-Up conversion (ADR 0155). */
  linkedPeople: GeneralActionPersonView[];
  status: GeneralActionStatus;
  /** Simple recurrence cadence, or null for a one-time Action (ADR 0148). */
  recurrence: GeneralActionRecurrence | null;
  /** Whether this Action is a Routine (has a cadence) — drives the Routine label. */
  isRoutine: boolean;
  /** A calm cadence label ("Every 6 months"), or null for a one-time Action. */
  recurrenceLabel: string | null;
  /** The one explicit alert schedule for this dated Action, separate from its due date. */
  reminderSchedule?: ReminderScheduleView | null;
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
  /**
   * The Action's owner, so a non-owner row can name who shared it (a co-member).
   *
   * Meaningless on a `household_native` record, where it is a storage key and not
   * an owner: no surface may render it as an author, and `ownership` is what
   * decides attribution and authority (ADR 0214).
   */
  ownerUserId: string;
  /**
   * The member this projection was built for.
   *
   * The view is already viewer-relative — `owned`, `authority`, and the holder
   * label all read against this member — and a household surface needs the id
   * itself to name *itself* as the Responsibility Holder without threading the
   * session through every row.
   */
  viewerUserId: string;
  /** Whose record this is, which is not the question `scope` answers (ADR 0214). */
  ownership: GeneralActionOwnership;
  /**
   * The occurrence this row was rendered against, sent back with a completion or
   * skip so a second member acting on the same occurrence is reconciled rather
   * than rolling it forward twice.
   */
  occurrenceVersion: number;
  /** The active member named as looking after a household-native record. */
  responsibilityHolderUserId: string | null;
  /**
   * "You're looking after this" / "Ana is looking after this", or `null`.
   *
   * Null when nobody is named — the ordinary, calmest state a household chore can
   * be in — and the surface renders nothing rather than a placeholder, because
   * "nobody has taken this on" would read as a reproach (ADR 0215).
   */
  responsibilityHolderLabel: string | null;
  /** What this viewer may do to it, per the Phase Eight authority table. */
  authority: GeneralActionAuthority;
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

/**
 * Resolves the calm surfacing cue — state + human label — for an Action: a paused Routine
 * reads as set aside (never overdue), a deferred one as "Set aside until …", a dated one by
 * its due state, and an undated one as "No date". Kept separate so the view mapper stays a
 * flat field projection. Exported for the Asset Profile's related-actions view (#199) so
 * both surfaces phrase an action's timing identically.
 */
export function resolveSurfacing(
  action: { status: GeneralActionStatus; deferUntil: Date | null; dueAt: Date | null },
  now: Date,
): { surfaceState: ActionSurfaceState; surfaceLabel: string } {
  const timing = resolveRecordTiming({ ...action, kind: "general_action" }, now);
  return { surfaceState: timing.state, surfaceLabel: timing.timingLabel };
}

/**
 * Maps a persisted General Action to a serializable view for client components.
 * Dates are pre-resolved server-side (label + date-input value) so the client
 * never re-derives timezones, matching the Follow-Up view seam.
 */
export function toGeneralActionView(
  action: {
    id: string;
    updatedAt: Date;
    title: string;
    notes: string | null;
    links: GeneralActionLink[];
    assetHints: GeneralActionAssetHint[];
    linkedPeople: GeneralActionPersonView[];
    status: GeneralActionStatus;
    recurrence: GeneralActionRecurrence | null;
    scope: PrivacyScope;
    ownerUserId: string;
    ownership: GeneralActionOwnership;
    responsibilityHolderUserId: string | null;
    occurrenceVersion: number;
    /** How many members a `shared` Action reaches; 0 otherwise. */
    sharedWithCount: number;
    /** The household's name for a `shared`/`household` Action, when one exists. */
    householdName: string | null;
    dueAt: Date | null;
    deferUntil: Date | null;
    areaId: string | null;
  },
  options: {
    now?: Date;
    callerUserId: string;
    linkedAssets?: GeneralActionLinkedAssetView[];
    /**
     * Display names for the caller's active co-members, so a named Responsibility
     * Holder is resolved here rather than on the client. The Actions surface loads
     * its household roster lazily, and a client-side lookup that has not arrived
     * yet renders nothing — which is indistinguishable from nobody being named,
     * the one state that must render nothing (ADR 0215).
     */
    memberNames?: ReadonlyMap<string, string>;
    reminderSchedule?: {
      kind: "exact" | "relative";
      localTime: string | null;
      leadMinutes: number | null;
      timeZone: string;
    } | null;
  },
): GeneralActionView {
  const now = options.now ?? new Date();
  const surfacing = resolveRecordSurfacing(
    {
      kind: "general_action",
      status: action.status,
      dueAt: action.dueAt,
      deferUntil: action.deferUntil,
      ownerUserId: action.ownerUserId,
      viewerUserId: options.callerUserId,
      scope: action.scope,
      sharedWithCount: action.sharedWithCount,
      householdName: action.householdName,
      updatedAt: action.updatedAt,
    },
    now,
  );

  return {
    id: action.id,
    revision: surfacing.revision,
    title: action.title,
    notes: action.notes,
    links: action.links,
    assetHints: action.assetHints,
    linkedAssets: options.linkedAssets ?? [],
    linkedPeople: action.linkedPeople,
    status: action.status,
    recurrence: action.recurrence,
    isRoutine: action.recurrence !== null,
    recurrenceLabel: action.recurrence ? describeRecurrence(action.recurrence) : null,
    reminderSchedule: options.reminderSchedule
      ? toReminderScheduleView(options.reminderSchedule)
      : null,
    scope: action.scope,
    visibilityLabel: surfacing.audienceLabel,
    owned: surfacing.owned,
    ownerUserId: action.ownerUserId,
    viewerUserId: options.callerUserId,
    ownership: action.ownership,
    occurrenceVersion: action.occurrenceVersion,
    responsibilityHolderUserId: action.responsibilityHolderUserId,
    responsibilityHolderLabel: action.responsibilityHolderUserId
      ? responsibilityHolderLabel({
          holderName: options.memberNames?.get(action.responsibilityHolderUserId) ?? null,
          isSelf: action.responsibilityHolderUserId === options.callerUserId,
        })
      : null,
    authority: resolveGeneralActionAuthority(action.ownership, surfacing.owned),
    areaId: action.areaId,
    dueAtISO: action.dueAt?.toISOString() ?? null,
    dueAtDate: action.dueAt ? toDateInputValue(action.dueAt) : "",
    deferUntilISO: action.deferUntil?.toISOString() ?? null,
    deferUntilDate: action.deferUntil ? toDateInputValue(action.deferUntil) : "",
    surfaceState: surfacing.state,
    surfaceLabel: surfacing.timingLabel,
  };
}

const EVENT_LABELS: Record<GeneralActionEventKind, string> = {
  created: "Created",
  edited: "Edited",
  completed: "Completed",
  skipped: "Skipped",
  reopened: "Reopened",
  deferred: "Set aside",
  dismissed: "Dismissed",
  archived: "Archived",
  paused: "Paused",
  resumed: "Resumed",
  // Review-gated history (ADRs 0151, 0152).
  suggested: "Suggested",
  promoted: "Accepted",
  ignored: "Ignored",
  // Household collaboration (ADRs 0214, 0215). Both read as plain statements of
  // what changed. History says who said what about who is looking after this; it
  // never scores it, and a hand-off is a change, not a handover of blame.
  responsibility_changed: "Who's looking after this changed",
  handed_to_household: "Handed to the household",
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
// fallow-ignore-next-line complexity -- Event-specific labels are centralized in this serialization boundary.
export function toGeneralActionEventView(
  event: Pick<GeneralActionEvent, "id" | "kind" | "detailJson" | "createdAt">,
  now: Date = new Date(),
): GeneralActionEventView {
  let label = EVENT_LABELS[event.kind];
  const deferUntil = event.detailJson?.deferUntil;
  if (event.kind === "deferred" && typeof deferUntil === "string") {
    const date = new Date(deferUntil);
    if (!Number.isNaN(date.getTime())) {
      label = `Set aside until ${formatSurfacingDay(date, now)}`;
    }
  }
  if (event.kind === "responsibility_changed") {
    // The three shapes of the one write, told apart by detail rather than by kind.
    // Names are deliberately absent: history is read by whoever opens it, and a
    // roster lookup here would be a second, quieter place attribution could drift.
    if (event.detailJson?.handedOff === true) {
      label = "Handed on";
    } else if (event.detailJson?.holderUserId === null) {
      label = "No one in particular is looking after this";
    }
  }

  return {
    id: event.id,
    kind: event.kind,
    label,
    atISO: event.createdAt.toISOString(),
    atLabel: formatSurfacingDay(event.createdAt, now),
  };
}
