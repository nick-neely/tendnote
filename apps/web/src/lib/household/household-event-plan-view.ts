import {
  findHouseholdCalendarEvent,
  type HouseholdCalendarEventRef,
  type HouseholdCalendarRead,
  householdCalendarEventKey,
} from "@tendnote/domain/household-calendar";
import type {
  HouseholdEventPlan,
  HouseholdEventPlanCalendarReference,
  HouseholdEventPlanLinkKind,
  HouseholdEventPlanStatus,
} from "@tendnote/domain/household-event-plans";
import { householdEventPlanCalendarRef } from "@tendnote/domain/household-event-plans";

/**
 * How a Household Event Plan reads on a Household surface (issue #387).
 *
 * A Plan is household-native, and this shape keeps it that way. It carries the
 * Plan's own title, notes, and date, and it carries the *address* of at most one
 * provider event resolved against the calendars that were just read. It never
 * folds provider content into the Plan's own fields, so an event that moved,
 * was cancelled, or cannot be read leaves the Plan exactly as its members wrote
 * it.
 *
 * Provenance here is three facts and nothing else: who started it, who last
 * changed it, and when. Not an activity feed, not a comment thread, and not a
 * display of anybody's membership state.
 *
 * Pure: the authorization that decided which Plans exist happened before this,
 * and rebuilding these views on the client after a mutation must produce the
 * same answer as the server's first render.
 */

/** How a member is named in provenance. Their own name reads as "you". */
export const HOUSEHOLD_EVENT_PLAN_DEPARTED_ACTOR = "someone who's left";

/**
 * What each linkable family is called on the surface.
 *
 * The household's word for the record, not the schema's: a member reading a Plan
 * has never heard of a `general_action`. Three families, and the list is closed
 * by the domain rather than by this map.
 */
const HOUSEHOLD_EVENT_PLAN_LINK_KIND_LABELS: Record<HouseholdEventPlanLinkKind, string> = {
  general_action: "Action",
  followup: "Follow-up",
  saved_item: "Saved item",
};

/** The fixed order the picker offers the families in. */
const HOUSEHOLD_EVENT_PLAN_LINK_KIND_ORDER: readonly HouseholdEventPlanLinkKind[] = [
  "general_action",
  "followup",
  "saved_item",
];

/**
 * A record the reader could link, as their own owner-scoped lists reported it.
 *
 * Only what a press needs: which family, which record, and what to call it. It
 * is a candidate rather than a permission - the link mutation proves the
 * caller's view of the target again for itself (ADR 0219).
 */
export type HouseholdEventPlanLinkCandidate = {
  kind: HouseholdEventPlanLinkKind;
  id: string;
  title: string;
};

/**
 * One link on a Plan, already proved for this reader.
 *
 * It carries the target's own title because a link is context and has to read as
 * the thing it points at. It never carries the record's body, and the surface
 * never shows either id: `recordId` is here only so the picker can leave out
 * what this Plan already links.
 */
export type HouseholdEventPlanLinkView = {
  /** What an unlink is written against. */
  id: string;
  kind: HouseholdEventPlanLinkKind;
  kindLabel: string;
  recordId: string;
  title: string;
};

/** The families the picker offers, each with what is left to choose from. */
export type HouseholdEventPlanLinkChoiceGroup = {
  kind: HouseholdEventPlanLinkKind;
  label: string;
  candidates: HouseholdEventPlanLinkCandidate[];
};

export type HouseholdEventPlanProvenance = {
  /** Display name of the member who created the Plan, or "you". */
  startedBy: string;
  /** Who last changed it, or `null` when nothing has changed it since. */
  changedBy: string | null;
  /** When the fact above happened. A machine fact - render it in mono. */
  atLabel: string;
};

export type HouseholdEventPlanView = {
  id: string;
  title: string;
  details: string | null;
  /** The household's own note of when this is, never the provider's answer. */
  plannedForLabel: string | null;
  /** `YYYY-MM-DD`, so an edit form round-trips the stored date without drift. */
  plannedForInput: string;
  status: HouseholdEventPlanStatus;
  /** The fence an edit, archive, or restore is written against. */
  version: number;
  calendar: HouseholdEventPlanCalendarReference;
  /**
   * The stored address itself, kept beside the resolved reference so an edit can
   * restate it. A write replaces the Plan's whole value, so a form that omitted
   * this would drop the event a Plan refers to as a side effect of fixing a typo
   * - including when the reference happens to be unresolvable today.
   */
  calendarAddress: HouseholdCalendarEventRef | null;
  /** The records this reader was proved for, in the order they were linked. */
  links: HouseholdEventPlanLinkView[];
  provenance: HouseholdEventPlanProvenance;
};

/**
 * A Plan as the read layer hands it over: the record and the links that survived
 * this reader's proof.
 *
 * Structural on purpose, so the shape the database returns satisfies it without
 * this client-side module importing anything from the query package.
 */
export type HouseholdEventPlanRecord = {
  plan: HouseholdEventPlan;
  links: readonly {
    id: string;
    linkKind: HouseholdEventPlanLinkKind;
    recordId: string;
    title: string;
  }[];
};

export type HouseholdEventPlanGroups = {
  active: HouseholdEventPlanView[];
  archived: HouseholdEventPlanView[];
};

/** What a member is shown beside their preserved draft when a save lost the fence. */
export type HouseholdEventPlanConflictView = {
  title: string;
  details: string | null;
  plannedForLabel: string | null;
  /** Who wrote the value that beat them. */
  changedBy: string;
  atLabel: string;
  /** The version their next attempt must be written against. */
  version: number;
};

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
}

function momentFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

/**
 * How one member id is written in provenance.
 *
 * A name comes from the household's current roster, which is the only place the
 * surface has one. An id that is not on it belongs to someone who is no longer
 * here: their attribution is kept - a Plan does not lose its history when its
 * author leaves - but there is no name left to print, and inventing one or
 * printing a raw id would both be worse than saying so plainly.
 */
export function householdActorName(input: {
  userId: string | null;
  viewerUserId: string;
  memberNames: ReadonlyMap<string, string>;
}): string {
  if (input.userId === null) return HOUSEHOLD_EVENT_PLAN_DEPARTED_ACTOR;
  if (input.userId === input.viewerUserId) return "you";
  return input.memberNames.get(input.userId) ?? HOUSEHOLD_EVENT_PLAN_DEPARTED_ACTOR;
}

/**
 * Resolves a Plan's stored calendar address against the calendars just read.
 *
 * Three outcomes, and only three. `none` is a Plan that never referred to an
 * event. `event` is a reference that resolved, carrying the family's own
 * freshness so the surface can say it may be out of date. `unavailable` covers
 * every way a reference can fail to resolve - the connection was disconnected,
 * the connector left, the provider is unreachable, the event was deleted, or it
 * simply falls outside the window that was read. The Plan keeps its own content
 * in all of them, and no cached provider content is ever substituted.
 */
export function resolveHouseholdEventPlanCalendarReference(
  plan: HouseholdEventPlan,
  read: HouseholdCalendarRead | null,
): HouseholdEventPlanCalendarReference {
  const ref = householdEventPlanCalendarRef(plan);
  if (!ref) return { state: "none" };
  if (!read) return { state: "unavailable" };

  const family = read.families.find((candidate) => candidate.connectionId === ref.connectionId);
  if (family?.state !== "events") return { state: "unavailable" };

  const event = findHouseholdCalendarEvent(read, ref);
  if (!event) return { state: "unavailable" };

  return {
    state: "event",
    connectionId: family.connectionId,
    label: family.label,
    title: event.title?.trim() ? event.title : null,
    start: event.start,
    allDay: event.allDay,
    stale: family.stale,
  };
}

function toPlanView(
  entry: HouseholdEventPlanRecord,
  input: {
    read: HouseholdCalendarRead | null;
    viewerUserId: string;
    memberNames: ReadonlyMap<string, string>;
    timeZone: string;
  },
): HouseholdEventPlanView {
  const { plan } = entry;
  const changed = plan.version > 1;
  return {
    id: plan.id,
    title: plan.title,
    details: plan.details,
    plannedForLabel: plan.plannedFor ? dayFormatter(input.timeZone).format(plan.plannedFor) : null,
    plannedForInput: plan.plannedFor ? plan.plannedFor.toISOString().slice(0, 10) : "",
    status: plan.status,
    version: plan.version,
    calendar: resolveHouseholdEventPlanCalendarReference(plan, input.read),
    calendarAddress: householdEventPlanCalendarRef(plan),
    links: entry.links.map((link) => ({
      id: link.id,
      kind: link.linkKind,
      kindLabel: HOUSEHOLD_EVENT_PLAN_LINK_KIND_LABELS[link.linkKind],
      recordId: link.recordId,
      title: link.title,
    })),
    provenance: {
      startedBy: householdActorName({
        userId: plan.createdByUserId,
        viewerUserId: input.viewerUserId,
        memberNames: input.memberNames,
      }),
      changedBy: changed
        ? householdActorName({
            userId: plan.lastActorUserId,
            viewerUserId: input.viewerUserId,
            memberNames: input.memberNames,
          })
        : null,
      atLabel: momentFormatter(input.timeZone).format(changed ? plan.updatedAt : plan.createdAt),
    },
  };
}

/**
 * Groups and orders this household's Plans.
 *
 * Active Plans lead, dated ones first in the order they are coming up, then the
 * undated with the newest first - an occasion with a date is the thing a
 * household is looking for, and one without a date is usually the thing someone
 * has just started. Archived Plans follow, most recently touched first, so
 * bringing one back is easy without archived work crowding the live list.
 */
export function buildHouseholdEventPlanViews(input: {
  plans: readonly HouseholdEventPlanRecord[];
  read: HouseholdCalendarRead | null;
  viewerUserId: string;
  memberNames: ReadonlyMap<string, string>;
  timeZone?: string;
}): HouseholdEventPlanGroups {
  const timeZone = input.timeZone ?? "UTC";
  const context = {
    read: input.read,
    viewerUserId: input.viewerUserId,
    memberNames: input.memberNames,
    timeZone,
  };

  const active = input.plans
    .filter((entry) => entry.plan.status === "active")
    .sort(({ plan: left }, { plan: right }) => {
      if (left.plannedFor && right.plannedFor) {
        return left.plannedFor.getTime() - right.plannedFor.getTime();
      }
      if (left.plannedFor) return -1;
      if (right.plannedFor) return 1;
      return right.createdAt.getTime() - left.createdAt.getTime();
    })
    .map((entry) => toPlanView(entry, context));

  const archived = input.plans
    .filter((entry) => entry.plan.status === "archived")
    .sort(({ plan: left }, { plan: right }) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .map((entry) => toPlanView(entry, context));

  return { active, archived };
}

/**
 * What the picker still has to offer this Plan.
 *
 * A record this Plan already links is not a choice, so it is left out rather
 * than shown disabled: the picker is a list of things that would work. A family
 * with nothing left to offer disappears with it, because an empty heading is
 * just a heading.
 */
export function buildHouseholdEventPlanLinkChoices(input: {
  candidates: readonly HouseholdEventPlanLinkCandidate[];
  links: readonly HouseholdEventPlanLinkView[];
}): HouseholdEventPlanLinkChoiceGroup[] {
  const linked = new Set(input.links.map((link) => `${link.kind}:${link.recordId}`));
  const available = input.candidates.filter(
    (candidate) => !linked.has(`${candidate.kind}:${candidate.id}`),
  );

  return HOUSEHOLD_EVENT_PLAN_LINK_KIND_ORDER.map((kind) => ({
    kind,
    label: HOUSEHOLD_EVENT_PLAN_LINK_KIND_LABELS[kind],
    candidates: available.filter((candidate) => candidate.kind === kind),
  })).filter((group) => group.candidates.length > 0);
}

/**
 * The addresses of every calendar event an active Plan already refers to.
 *
 * Archived Plans are left out: a household that archived last year's school
 * event should be able to plan this year's without the calendar row claiming it
 * is already handled.
 */
export function plannedHouseholdCalendarEventKeys(
  plans: readonly HouseholdEventPlan[],
): Set<string> {
  const keys = new Set<string>();
  for (const plan of plans) {
    if (plan.status !== "active") continue;
    const ref = householdEventPlanCalendarRef(plan);
    if (ref) keys.add(householdCalendarEventKey(ref));
  }
  return keys;
}

/** The value that beat a member's save, as the conflict surface states it. */
export function buildHouseholdEventPlanConflictView(input: {
  current: HouseholdEventPlan;
  viewerUserId: string;
  memberNames: ReadonlyMap<string, string>;
  timeZone?: string;
}): HouseholdEventPlanConflictView {
  const timeZone = input.timeZone ?? "UTC";
  return {
    title: input.current.title,
    details: input.current.details,
    plannedForLabel: input.current.plannedFor
      ? dayFormatter(timeZone).format(input.current.plannedFor)
      : null,
    changedBy: householdActorName({
      userId: input.current.lastActorUserId,
      viewerUserId: input.viewerUserId,
      memberNames: input.memberNames,
    }),
    atLabel: momentFormatter(timeZone).format(input.current.updatedAt),
    version: input.current.version,
  };
}
