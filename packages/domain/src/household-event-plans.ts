import { z } from "zod";
import type { HouseholdCalendarEventRef } from "./household-calendar";
import { HouseholdValidationError } from "./household-policy";

/**
 * Household Event Plans (Phase Eight, ADR 0217).
 *
 * A Household Event Plan is a household-native Tendnote record for the
 * coordination around an occasion. It is a companion to a provider calendar
 * event, never a copy of one: it may hold the address of one Household Calendar
 * Event, and it holds none of that event's content. If the provider event moves,
 * is cancelled, or becomes unreadable, the Plan is unchanged and the members
 * decide what to do - Tendnote does not reconcile a second timeline it was never
 * the authority for.
 *
 * What this module deliberately does not model, because each of them would make
 * the Plan a claim about provider truth or about people:
 *
 * - No RSVP, attendance, availability, guest list, or invitee. Google owns
 *   attendance; a Plan that stored it would be a second, wrong answer.
 * - No per-member state at all: no assignee, turn order, seen/unseen, or
 *   acknowledgement. The Plan belongs to the workspace, symmetrically.
 * - No reminders. A member who wants to be reminded creates their own Action or
 *   Follow-Up with their own Reminder Schedule, which alerts only their devices.
 */

export const HOUSEHOLD_EVENT_PLAN_TITLE_LIMIT = 120;
export const HOUSEHOLD_EVENT_PLAN_DETAILS_LIMIT = 2000;

/**
 * How many existing records one Plan may link.
 *
 * Bounded because every link is proved independently on every read (ADR 0219),
 * so an unbounded list is an unbounded authorization cost on a read-first
 * surface - and because a Plan that links thirty records has stopped being one
 * occasion's coordination.
 */
export const HOUSEHOLD_EVENT_PLAN_LINK_LIMIT = 12;

/**
 * Archive is the removal path. A Plan is workspace-owned, so no individual
 * member may permanently delete one; ending is the household's lifecycle, not a
 * member's button.
 */
export const householdEventPlanStatusSchema = z.enum(["active", "archived"]);
export type HouseholdEventPlanStatus = z.infer<typeof householdEventPlanStatusSchema>;

/**
 * The record families a Plan may link.
 *
 * Only families the Household Authorization Proof already covers, because a link
 * is proved before it is revealed and there is no way to prove a family the
 * engine cannot describe.
 *
 * Three families the Phase Eight contract names are absent, for three different
 * reasons:
 *
 * - **People.** A Plan naming a Person would reach into a member's private
 *   People graph. The record-local Person Reference that lets a household-native
 *   record name someone without doing that is #388's to define, so this waits on
 *   a shape rather than inventing a second one.
 * - **Birthday occasions.** They hang off a Person, so they follow People.
 * - **Household Context.** Nothing here is undecided: its authorization seam is
 *   #382's, and a Plan cannot prove a Context fact against a seam that does not
 *   exist yet. A wiring dependency to close once #382 merges, not a product
 *   question, and tracked as a post-merge integration task.
 *
 * `saved_item` is here and is not in the contract's list. It earns the place on
 * the same test the others fail: #385 makes Saved Items household-native, the
 * proof engine already describes them, and "the thing we said we'd bring" is
 * exactly what a Plan wants to point at. Until the deferred families arrive, a
 * Plan can say whose birthday it is, or what the household already decided, in
 * its own details.
 */
export const householdEventPlanLinkKindSchema = z.enum([
  "general_action",
  "followup",
  "saved_item",
]);
export type HouseholdEventPlanLinkKind = z.infer<typeof householdEventPlanLinkKindSchema>;

export const householdEventPlanLinkSchema = z.object({
  id: z.string(),
  planId: z.string(),
  linkKind: householdEventPlanLinkKindSchema,
  recordId: z.string(),
  /** Kept after the linker leaves: attribution is history, not standing. */
  linkedByUserId: z.string(),
  createdAt: z.coerce.date(),
});
export type HouseholdEventPlanLink = z.infer<typeof householdEventPlanLinkSchema>;

export const householdEventPlanSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  /** Provenance, not authority: the creator holds no more than any active member. */
  createdByUserId: z.string(),
  lastActorUserId: z.string(),
  title: z.string().min(1).max(HOUSEHOLD_EVENT_PLAN_TITLE_LIMIT),
  details: z.string().max(HOUSEHOLD_EVENT_PLAN_DETAILS_LIMIT).nullable().default(null),
  /**
   * The household's own note of when this is, for a Plan with no calendar event
   * or whose calendar event is not the whole story. It is Tendnote-native
   * planning content and is never derived from, reconciled with, or corrected
   * against the provider event.
   */
  plannedFor: z.coerce.date().nullable().default(null),
  status: householdEventPlanStatusSchema,
  archivedAt: z.coerce.date().nullable().default(null),
  /** The address of at most one Household Calendar Event - all three parts or none. */
  calendarConnectionId: z.string().nullable().default(null),
  calendarId: z.string().nullable().default(null),
  calendarProviderEventId: z.string().nullable().default(null),
  /**
   * Bumped on every material write. The fence for the concurrency contract: a
   * member editing a value someone else has since changed is refused and keeps
   * their draft, rather than silently winning.
   */
  version: z.number().int().positive(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type HouseholdEventPlan = z.infer<typeof householdEventPlanSchema>;

/* -------------------------------------------------------------------------- */
/* Drafts                                                                       */
/* -------------------------------------------------------------------------- */

export const householdEventPlanDraftSchema = z.object({
  title: z.string(),
  details: z.string().nullable().optional(),
  plannedFor: z.coerce.date().nullable().optional(),
  calendarEvent: z
    .object({
      connectionId: z.string().min(1),
      calendarId: z.string().min(1),
      providerEventId: z.string().min(1),
    })
    .nullable()
    .optional(),
});
export type HouseholdEventPlanDraft = z.input<typeof householdEventPlanDraftSchema>;

export type NormalizedHouseholdEventPlanDraft = {
  title: string;
  details: string | null;
  plannedFor: Date | null;
  calendarEvent: HouseholdCalendarEventRef | null;
};

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Validates and normalizes what a member typed.
 *
 * The refusals are curated sentences rather than schema errors because they are
 * rendered inline beside the field, and because "that didn't parse" is not an
 * answer anyone can act on. Over-long text is refused rather than truncated:
 * quietly dropping the end of someone's planning note is a worse outcome than
 * telling them it is too long.
 */
export function normalizeHouseholdEventPlanDraft(
  draft: HouseholdEventPlanDraft,
): NormalizedHouseholdEventPlanDraft {
  const parsed = householdEventPlanDraftSchema.parse(draft);
  const title = parsed.title.trim();
  if (!title) {
    throw new HouseholdValidationError("Give this plan a short name so everyone knows what it is.");
  }
  if (title.length > HOUSEHOLD_EVENT_PLAN_TITLE_LIMIT) {
    throw new HouseholdValidationError(
      `Keep the name to ${HOUSEHOLD_EVENT_PLAN_TITLE_LIMIT} characters or fewer.`,
    );
  }

  const details = trimmedOrNull(parsed.details);
  if (details && details.length > HOUSEHOLD_EVENT_PLAN_DETAILS_LIMIT) {
    throw new HouseholdValidationError(
      `Keep the notes to ${HOUSEHOLD_EVENT_PLAN_DETAILS_LIMIT} characters or fewer.`,
    );
  }

  return {
    title,
    details,
    plannedFor: parsed.plannedFor ?? null,
    calendarEvent: parsed.calendarEvent ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Lifecycle and authority                                                      */
/* -------------------------------------------------------------------------- */

/**
 * An archived Plan is read-only.
 *
 * Whether an archived record can still be edited is each domain's own lifecycle
 * rule rather than a Household privacy question - the Authorization Proof
 * deliberately declines to answer it (see `HouseholdRecordLifecycle`) - so this
 * is where a Plan answers it for itself.
 */
export function householdEventPlanEditRefusal(plan: {
  status: HouseholdEventPlanStatus;
}): string | null {
  if (plan.status === "archived") {
    return "This plan is archived. Bring it back first if you want to change it.";
  }
  return null;
}

export function assertHouseholdEventPlanEditable(plan: { status: HouseholdEventPlanStatus }): void {
  const refusal = householdEventPlanEditRefusal(plan);
  if (refusal) {
    throw new HouseholdValidationError(refusal);
  }
}

/* -------------------------------------------------------------------------- */
/* Optimistic concurrency                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What a member is shown when their edit was written against a value someone
 * else has since changed.
 *
 * It carries the current record and who last changed it so the surface can show
 * both sides - the member's preserved draft and the value it would have replaced
 * - and let them keep, revise, or explicitly replace. Tendnote never silently
 * last-write-wins and never attempts to merge two people's prose.
 */
export const HOUSEHOLD_EVENT_PLAN_CONFLICT_MESSAGE =
  "Someone else changed this plan while you were writing. Your draft is kept below.";

export class HouseholdEventPlanConflictError extends Error {
  override name = "HouseholdEventPlanConflictError";
  readonly current: HouseholdEventPlan;

  constructor(current: HouseholdEventPlan) {
    super(HOUSEHOLD_EVENT_PLAN_CONFLICT_MESSAGE);
    this.current = current;
  }
}

/**
 * Fences a material write against the version the member was looking at.
 *
 * `expectedVersion` is what their screen carried, not what they typed, so a
 * member who reopens an unchanged Plan and saves is never refused - only a
 * genuine overlap is.
 */
export function assertHouseholdEventPlanVersion(
  current: HouseholdEventPlan,
  expectedVersion: number,
): void {
  if (current.version !== expectedVersion) {
    throw new HouseholdEventPlanConflictError(current);
  }
}

/* -------------------------------------------------------------------------- */
/* Views                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How a Plan's calendar reference reads once the calendars have been read.
 *
 * `unavailable` is not an error state and not a prompt to fix anything: the
 * connection may have been disconnected, the connector may have left, or the
 * event may simply be outside the window that was read. In every case the Plan
 * keeps its own content and says the provider reference cannot be shown - it
 * never falls back to cached provider content as a substitute.
 */
export type HouseholdEventPlanCalendarReference =
  | { state: "none" }
  | { state: "unavailable" }
  | {
      state: "event";
      connectionId: string;
      label: string;
      title: string | null;
      start: Date;
      allDay: boolean;
      /** Provider-derived and possibly out of date, and the surface must say so. */
      stale: boolean;
    };

export type HouseholdEventPlanView = {
  plan: HouseholdEventPlan;
  calendarReference: HouseholdEventPlanCalendarReference;
  links: HouseholdEventPlanLink[];
};

/** The address form of a Plan's stored reference, or null when it has none. */
export function householdEventPlanCalendarRef(
  plan: Pick<HouseholdEventPlan, "calendarConnectionId" | "calendarId" | "calendarProviderEventId">,
): HouseholdCalendarEventRef | null {
  if (!plan.calendarConnectionId || !plan.calendarId || !plan.calendarProviderEventId) {
    return null;
  }
  return {
    connectionId: plan.calendarConnectionId,
    calendarId: plan.calendarId,
    providerEventId: plan.calendarProviderEventId,
  };
}
