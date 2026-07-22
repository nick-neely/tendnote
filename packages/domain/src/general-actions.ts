import { z } from "zod";
import { privacyScopeSchema } from "./privacy";

/**
 * A user-actionable validation failure in the General Action lifecycle (an invalid
 * transition, a terminal-state edit, a missing resurface date). Its `message` is
 * curated and safe to show the user, so surfaces can surface it directly instead
 * of a generic error — distinct from unexpected/infra errors, which stay generic.
 */
export class GeneralActionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneralActionValidationError";
  }
}

/**
 * A General Action's lifecycle state. Unlike a Follow-Up, a one-time General
 * Action need not be scheduled: `open` covers both "do this soon" and unscheduled
 * "someday" actions, and `deferred` is a deliberate set-aside with a resurface
 * date so the action comes back rather than silently disappearing (ADR 0149).
 * Terminal states preserve history without deleting the record (ADR 0165).
 *
 * `paused` is the one non-terminal set-aside unique to Routines (recurring General
 * Actions, ADR 0148): a paused Routine stops surfacing and stops rolling forward but
 * is not retired — the owner resumes it later. A one-time Action is never paused.
 *
 * `suggested` and `ignored` are the two review-gated states (ADRs 0144, 0151, 0152).
 * A `suggested` action is a review-gated proposal — it never surfaces on the active
 * Actions ledger or any proactive surface until the user accepts it, which promotes
 * it in place to `open` (a durable Action, or a Routine when it carries a cadence).
 * `ignored` is the quiet set-aside for a proposal the user doesn't want to act on:
 * it appears on neither the active nor the resolved ledger and has no transition out
 * (terminal in place), so a rejected-via-dismiss proposal is actually the *softer*,
 * recoverable one — `dismissed` stays in the resolved trail and can be reopened,
 * whereas `ignored` simply clears the proposal from view (a later extraction/Eve turn
 * can re-propose it). Both `suggested` and `ignored` sit outside the active lifecycle
 * transition matrix, which only governs durable actions (open/deferred and onward).
 */
export const generalActionStatusSchema = z.enum([
  "open",
  "deferred",
  "completed",
  "dismissed",
  "archived",
  "paused",
  "suggested",
  "ignored",
]);

/**
 * A lightweight link attached to a General Action — a URL with an optional label.
 * This is deliberately not attachment or document management: no uploads, files,
 * receipts, or warranty storage (ADR 0164).
 */
export const generalActionLinkSchema = z.object({
  url: z.url({ error: "Enter a valid link, including https://." }),
  label: z.string().trim().min(1).max(120).optional(),
});
export type GeneralActionLink = z.infer<typeof generalActionLinkSchema>;

/**
 * A lightweight object/asset hint on a General Action — a plain subject label like
 * "refrigerator water filter" or "car registration". Deliberately a structured stub
 * (an object, not a bare string) so a future Asset/Object Memory can attach an id or
 * richer fields and promote the hint without a data migration. Phase 5 stores no
 * durable asset records, profiles, warranties, serials, or maintenance history —
 * only the hint (ADR 0156).
 */
export const generalActionAssetHintSchema = z.object({
  label: z.string().trim().min(1).max(120),
});
export type GeneralActionAssetHint = z.infer<typeof generalActionAssetHintSchema>;

/** Hard cap on asset hints per Action. A hint is a passing label, not a catalog. */
export const MAX_ASSET_HINTS = 20;

/**
 * The calendar unit a Routine's cadence steps by. Deliberately the four plain units
 * a person actually says out loud ("every 6 months", "weekly") — SIMPLE recurrence
 * only: no business-day rules, no per-occurrence exceptions, no multi-step or
 * calendar-synced schedules (ADR 0147).
 */
export const generalActionRecurrenceUnitSchema = z.enum(["day", "week", "month", "year"]);
export type GeneralActionRecurrenceUnit = z.infer<typeof generalActionRecurrenceUnitSchema>;

/** Upper bound on a cadence interval, so "every N units" can't be an absurd number. */
export const MAX_RECURRENCE_INTERVAL = 365;

/**
 * A General Action's simple recurrence cadence: repeat "every `interval` `unit`s"
 * (e.g. every 6 months, every 2 weeks). Its mere presence is what makes a General
 * Action a Routine — Routine is a product label over one recurring model, not a
 * separate table (ADR 0148). Null cadence = a one-time Action.
 */
export const generalActionRecurrenceSchema = z.object({
  interval: z.number().int().min(1).max(MAX_RECURRENCE_INTERVAL),
  unit: generalActionRecurrenceUnitSchema,
});
export type GeneralActionRecurrence = z.infer<typeof generalActionRecurrenceSchema>;

export const generalActionSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  // The action itself, e.g. "Replace the refrigerator water filter". Product UI
  // labels one-time General Actions as "Actions" (ADR 0148).
  title: z.string().trim().min(1),
  notes: z.string().nullable().default(null),
  links: z.array(generalActionLinkSchema).default([]),
  status: generalActionStatusSchema.default("open"),
  // A General Action may be unscheduled (ADR 0149), so a due date is optional.
  dueAt: z.date().nullable().default(null),
  // Resurface date set when the action is deferred; the action comes back around
  // this date rather than disappearing (ADR 0149).
  deferUntil: z.date().nullable().default(null),
  // Source grounding where present: the source record a promoted suggestion came
  // from. Null for direct user-created actions (ADRs 0154, 0164). Later slices
  // (#180) promote Suggested General Actions with this set.
  sourceRecordId: z.string().nullable().default(null),
  // At most one primary Area per Action in Phase 5 — a flat life category, not a
  // project or tag (ADR 0146, #179). Null when the Action is unfiled.
  areaId: z.string().nullable().default(null),
  // Visibility scope (ADR 0153). private = owner only; household = every active
  // member of `householdId`; shared = the owner plus selected members. Fail closed:
  // a non-private scope always carries a household (#180).
  scope: privacyScopeSchema.default("private"),
  householdId: z.string().nullable().default(null),
  // Lightweight object/asset hints carried before Asset/Object Memory exists, so a
  // later phase can link or promote them without rework (ADR 0156). Never durable
  // asset records — just labels. Count-bounded here in the domain (not only at the
  // web edge) so no caller can attach an unbounded pile of hints.
  assetHints: z.array(generalActionAssetHintSchema).max(MAX_ASSET_HINTS).default([]),
  // Simple recurrence cadence. Non-null makes this a Routine (labeled as such in
  // product UI); null is a one-time Action (ADRs 0147, 0148). A Routine may still be
  // unscheduled — a cadence without a current due date — until its first completion
  // anchors one.
  recurrence: generalActionRecurrenceSchema.nullable().default(null),
  // Creator provenance and actor provenance for lifecycle changes (ADR 0154).
  createdByUserId: z.string().nullable().optional(),
  lastActorUserId: z.string().nullable().optional(),
  completedAt: z.date().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createGeneralActionSchema = generalActionSchema
  .omit({
    createdAt: true,
    updatedAt: true,
  })
  .extend({ id: z.uuid().optional() });

export type GeneralAction = z.infer<typeof generalActionSchema>;
export type GeneralActionStatus = z.infer<typeof generalActionStatusSchema>;
export type CreateGeneralActionInput = z.input<typeof createGeneralActionSchema>;

/**
 * Validates a bounded update patch for a persisted General Action. Deliberately
 * carries **no defaults** — unlike `generalActionSchema.partial()`, an absent key
 * stays absent instead of being filled with a default. A partial of the base
 * schema would inject `dueAt: null`, `notes: null`, `links: []`, `scope: private`
 * for keys the caller never set, silently wiping those columns on every update. A
 * store that sets only the returned keys must use this schema, not a partial of
 * the base one.
 */
export const generalActionUpdateSchema = z
  .object({
    title: z.string().trim().min(1),
    notes: z.string().nullable(),
    links: z.array(generalActionLinkSchema),
    assetHints: z.array(generalActionAssetHintSchema).max(MAX_ASSET_HINTS),
    status: generalActionStatusSchema,
    dueAt: z.date().nullable(),
    deferUntil: z.date().nullable(),
    recurrence: generalActionRecurrenceSchema.nullable(),
    areaId: z.string().nullable(),
    // Visibility is a mutable patch field so an Action can be re-scoped in place
    // (#180). Defaults-free like the rest of this schema: an absent key is never
    // filled, so a content edit can never silently widen or narrow visibility.
    scope: privacyScopeSchema,
    householdId: z.string().nullable(),
    completedAt: z.date().nullable(),
    lastActorUserId: z.string().nullable(),
  })
  .partial();

export type GeneralActionUpdate = z.infer<typeof generalActionUpdateSchema>;

/**
 * Statuses that count as still-on-your-plate actions: open reminders and
 * deliberately deferred ones. The Actions surface and any resurfacing logic treat
 * these — and only these — as active (ADR 0149, 0157).
 */
export const ACTIVE_GENERAL_ACTION_STATUSES: ReadonlySet<GeneralActionStatus> = new Set([
  "open",
  "deferred",
]);

export function isActiveGeneralActionStatus(status: GeneralActionStatus): boolean {
  return ACTIVE_GENERAL_ACTION_STATUSES.has(status);
}

/**
 * Review-gated statuses that are owner-only: a `suggested` proposal and an `ignored`
 * (set-aside) proposal are never a durable action, so scope-visible reads exclude
 * them. A household member can never fetch — or read the history of — a proposal that
 * has not been accepted, even one proposed at household scope, because visibility only
 * begins at acceptance (ADRs 0151, 0152, 0153). The owner still reaches their own
 * proposals through owner-scoped reads in the review lifecycle.
 */
export const REVIEW_GENERAL_ACTION_STATUSES: ReadonlySet<GeneralActionStatus> = new Set([
  "suggested",
  "ignored",
]);

export function isReviewGeneralActionStatus(status: GeneralActionStatus): boolean {
  return REVIEW_GENERAL_ACTION_STATUSES.has(status);
}

/**
 * The durable statuses whose General Actions participate in retrieval (exact recall and
 * semantic): a durable action is retrievable while it is still live — `open`, `deferred`,
 * or a `paused` Routine — so a caller can find what is on their plate; terminal actions
 * (`completed`, `dismissed`, `archived`) drop out of retrieval like resolved rows drop
 * off the active ledger. `suggested` is handled separately (owner-only review context,
 * see {@link canRetrieveGeneralAction}); `ignored` is the quiet set-aside and is never
 * retrievable. Mirrors how memories retrieve only while `approved` and source records
 * only while `active`.
 *
 * This constant documents the durable-status policy and is the predicate the in-memory
 * retrieval stores filter on (via {@link canRetrieveGeneralAction}). The drizzle stores
 * inline the same status list in SQL for the query plan; a string-assertion test
 * (semantic-retrieval `migration-shape`) pins the SQL to this policy so the two never
 * drift.
 */
export const RETRIEVABLE_GENERAL_ACTION_STATUSES: ReadonlySet<GeneralActionStatus> = new Set([
  "open",
  "deferred",
  "paused",
]);

export const HISTORICAL_GENERAL_ACTION_STATUSES: ReadonlySet<GeneralActionStatus> = new Set([
  "completed",
  "dismissed",
  "archived",
]);

export function isRetrievableGeneralActionStatus(status: GeneralActionStatus): boolean {
  return RETRIEVABLE_GENERAL_ACTION_STATUSES.has(status);
}

/**
 * The single retrieval-visibility gate a caller's General Action must pass to appear in
 * exact recall or semantic search, shared by both in-memory retrieval stores so they
 * never fork the policy. Two disjoint ways a General Action is retrievable:
 *
 * - **Durable + scope-visible:** a live action (`open`/`deferred`/`paused`) that the
 *   caller may see under the Phase 4 scope rules. `scopeVisible` is the result of the
 *   household scope predicate, computed by the store; this gate never widens it.
 * - **Suggested in owner-only review context:** a `suggested` proposal, only when the
 *   caller both owns it and asked for review context. A proposal is never scope-visible
 *   to a household member until accepted, so review context can never reach another
 *   owner's proposal (ADRs 0151–0153).
 *
 * `ignored` and terminal actions fall through both branches and never surface. The
 * drizzle stores express this same `(scopeVisible AND durable) OR (review AND owner AND
 * suggested)` predicate inline in SQL, citing this helper.
 */
export function canRetrieveGeneralAction(input: {
  status: GeneralActionStatus;
  ownerUserId: string;
  callerUserId: string;
  scopeVisible: boolean;
  includeReviewGated: boolean;
  includeArchived?: boolean;
}): boolean {
  if (isRetrievableGeneralActionStatus(input.status)) return input.scopeVisible;
  if (input.includeArchived && HISTORICAL_GENERAL_ACTION_STATUSES.has(input.status)) {
    return input.scopeVisible;
  }
  if (input.status !== "suggested") return false;
  return input.includeReviewGated && input.ownerUserId === input.callerUserId;
}

/**
 * The retrieval-facing shape of a General Action carried on a typed retrieval result,
 * so a consumer (Eve tools in #185, Action Today in #186) can tell an Action from a
 * Routine from a Suggested action without re-fetching the row. `recordKind` on the
 * result already separates General Actions from people, memories, source records, and
 * Follow-Ups; this narrows *within* General Actions: `isRoutine` marks the recurring
 * ones (ADR 0148) and `isSuggested` marks the review-gated proposals (ADRs 0151, 0152).
 * `status` and `areaId` round out the calm, non-leaking metadata a surface renders.
 */
export const generalActionRetrievalMetaSchema = z.object({
  status: generalActionStatusSchema,
  isRoutine: z.boolean(),
  isSuggested: z.boolean(),
  areaId: z.string().nullable(),
});

export type GeneralActionRetrievalMeta = z.infer<typeof generalActionRetrievalMetaSchema>;

/**
 * Builds the retrieval metadata for a General Action from its stored fields, so both
 * retrieval stores (and both adapters) derive Routine/Suggested/Area exactly the same
 * way rather than re-deriving the booleans inline and drifting.
 */
export function generalActionRetrievalMeta(
  action: Pick<GeneralAction, "status" | "recurrence" | "areaId">,
): GeneralActionRetrievalMeta {
  return {
    status: action.status,
    isRoutine: action.recurrence !== null,
    isSuggested: action.status === "suggested",
    areaId: action.areaId,
  };
}

/**
 * Statuses a General Action's content (title, notes, links, due date, cadence) may
 * still be edited from. Editing a completed, dismissed, or archived action is
 * rejected — those are terminal for content edits; the user reopens first (ADR 0165).
 * A paused Routine remains editable at the domain level for programmatic/Eve callers;
 * the web surface exposes content edits only on active rows (a paused row offers just
 * resume/archive), and a paused Routine's cadence can never be *removed* in place —
 * that would leave a paused one-time Action (see `assertRecurrenceEditAllowed`).
 */
export const EDITABLE_GENERAL_ACTION_STATUSES: ReadonlySet<GeneralActionStatus> = new Set([
  "open",
  "deferred",
  "paused",
]);

/**
 * Explicit General Action lifecycle transitions. This is the single validated
 * matrix for the whole one-time action lifecycle so callers (web and, later, Eve)
 * cannot make invalid status jumps. Mirrors the Follow-Up lifecycle matrix while
 * staying a separate model (ADR 0143).
 */
export type GeneralActionLifecycleAction =
  | "complete"
  | "defer"
  | "dismiss"
  | "reopen"
  | "archive"
  | "pause"
  | "resume";

const GENERAL_ACTION_TRANSITIONS: Record<
  GeneralActionLifecycleAction,
  { from: ReadonlySet<GeneralActionStatus>; to: GeneralActionStatus }
> = {
  complete: { from: new Set(["open", "deferred"]), to: "completed" },
  defer: { from: new Set(["open", "deferred"]), to: "deferred" },
  dismiss: { from: new Set(["open", "deferred"]), to: "dismissed" },
  reopen: { from: new Set(["completed", "dismissed"]), to: "open" },
  // Pausing sets a Routine aside without retiring it; resuming brings it back to
  // open. Only Routines pause (guarded at the lifecycle seam), so these never apply
  // to a one-time Action (ADR 0148).
  pause: { from: new Set(["open", "deferred"]), to: "paused" },
  resume: { from: new Set(["paused"]), to: "open" },
  // Archive preserves history while removing an action from active views. It is
  // reachable from any non-archived state, a paused Routine included.
  archive: {
    from: new Set(["open", "deferred", "completed", "dismissed", "paused"]),
    to: "archived",
  },
};

/**
 * Resolves the target status for a lifecycle action, rejecting invalid jumps with
 * a clear error. Single source of truth for allowed transitions so surfaces cannot
 * fork the rules.
 */
export function resolveGeneralActionTransition(
  current: GeneralActionStatus,
  action: GeneralActionLifecycleAction,
): GeneralActionStatus {
  const rule = GENERAL_ACTION_TRANSITIONS[action];

  if (!rule.from.has(current)) {
    throw new GeneralActionValidationError(`Cannot ${action} an action that is ${current}.`);
  }

  return rule.to;
}

export function assertGeneralActionEditable(status: GeneralActionStatus): void {
  if (!EDITABLE_GENERAL_ACTION_STATUSES.has(status)) {
    throw new GeneralActionValidationError(`Cannot edit an action that is ${status}.`);
  }
}

/**
 * Guards that a deferral has a concrete resurface date. Deferring is a deliberate
 * "bring this back later" action, so it must name when — an action can never be
 * deferred into a void it never returns from (ADR 0149).
 */
export function assertResurfaceDate(deferUntil: unknown): Date {
  if (!(deferUntil instanceof Date) || Number.isNaN(deferUntil.getTime())) {
    throw new GeneralActionValidationError("A deferred action needs a concrete resurface date.");
  }

  return deferUntil;
}

/** Whether a General Action is a Routine — i.e. carries a recurrence cadence (ADR 0148). */
export function isGeneralActionRoutine(action: Pick<GeneralAction, "recurrence">): boolean {
  return action.recurrence !== null;
}

/**
 * Guards that an action is a Routine before it can be paused. Pausing is a
 * Routine-only affordance — a one-time Action has nothing recurring to suspend, so
 * it is dismissed or archived instead (ADRs 0147, 0148).
 */
export function assertPausableRoutine(action: Pick<GeneralAction, "recurrence">): void {
  if (action.recurrence === null) {
    throw new GeneralActionValidationError("Only a routine can be paused.");
  }
}

/** The last calendar day (1–31) of a local month, for month-end clamping. */
function lastDayOfMonth(year: number, monthIndex: number): number {
  // Day 0 of the *next* month is the last day of this one; local construction.
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Adds whole months to a local calendar day, clamping the day to the target month's
 * length so month-end never overflows: Jan 31 + 1 month → Feb 28 (or 29), not Mar 3.
 * Returns local midnight of the resulting day.
 */
function addMonthsClamped(from: Date, months: number): Date {
  const targetIndex = from.getMonth() + months;
  const targetYear = from.getFullYear() + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const day = Math.min(from.getDate(), lastDayOfMonth(targetYear, targetMonth));
  return new Date(targetYear, targetMonth, day);
}

/**
 * The next due date for a Routine, rolled forward one cadence step from `from`
 * (normally the completion moment). We anchor on the completion date rather than the
 * previous due date — "every 6 months" means six months from when you actually did
 * it, which is calmer and drift-tolerant: a Routine done late is never treated as a
 * pile of missed occurrences, it simply schedules the next one from now (ADRs 0147,
 * 0165; a missed occurrence is not a failure).
 *
 * The result is local midnight of the target calendar day, matching how due dates
 * are stored elsewhere. Day/week steps use local wall-clock day arithmetic, so they
 * stay correct across DST transitions; month/year steps clamp month-end.
 */
export function nextRoutineDueAt(recurrence: GeneralActionRecurrence, from: Date): Date {
  const year = from.getFullYear();
  const month = from.getMonth();
  const day = from.getDate();

  switch (recurrence.unit) {
    case "day":
      return new Date(year, month, day + recurrence.interval);
    case "week":
      return new Date(year, month, day + recurrence.interval * 7);
    case "month":
      return addMonthsClamped(from, recurrence.interval);
    case "year":
      return addMonthsClamped(from, recurrence.interval * 12);
  }
}

/**
 * Whether an Action is asking for attention *now* on a proactive surface (a brief, a
 * Today view) at instant `now`. True for a scheduled Action due today or overdue, and
 * for a deferred one whose resurface date has arrived. False for anything dated in the
 * future — and, deliberately, false for an unscheduled Action, so a dateless "someday"
 * item never floods proactive surfaces; it stays discoverable on the Actions ledger
 * and resurfaces only when the owner gives it a date (ADR 0149). Paused Routines and
 * terminal Actions never surface. A Routine follows the same rule via its rolled-
 * forward due date, so its cadence — not a nag — is what brings it back.
 */
export function isProactivelySurfacing(
  action: Pick<GeneralAction, "status" | "dueAt" | "deferUntil">,
  now: Date,
): boolean {
  if (action.status === "deferred") {
    return action.deferUntil !== null && action.deferUntil.getTime() <= now.getTime();
  }
  if (action.status !== "open") {
    return false;
  }
  return action.dueAt !== null && action.dueAt.getTime() <= now.getTime();
}

/**
 * Why an Action is asking for attention *now*, for a surface that groups the same
 * three proactive buckets the narrow Action Today view and the scoped summaries use
 * (ADRs 0157, 0158). Derived from the exact same boundary as
 * {@link isProactivelySurfacing} — this only adds the *reason*, never widens *whether*
 * something surfaces, so the two can never disagree. `overdue` and `due_today` split a
 * scheduled open action by local calendar day (never by wall-clock instant, so a thing
 * due today reads "due today" all day rather than flipping to "overdue" as the clock
 * passes its stored midnight); `resurfaced` is a deferred action whose set-aside date
 * has come back around (ADR 0149).
 */
export type ActionSurfacingReason = "overdue" | "due_today" | "resurfaced";

/**
 * Classifies why a General Action is on a proactive surface at instant `now`, or
 * returns null when it is not surfacing at all — an unscheduled someday action, a
 * future-dated one, a not-yet-arrived deferral, a paused Routine, or a terminal
 * action. A caller filters and labels in a single pass: a null reason means "leave it
 * off the surface", so the calm Today view and the summary never re-derive the
 * boundary. A Routine follows the same rule through its rolled-forward due date, so
 * its cadence — not a nag — is what brings it back (ADRs 0147, 0149, 0157).
 */
export function classifyActionSurfacing(
  action: Pick<GeneralAction, "status" | "dueAt" | "deferUntil">,
  now: Date,
): ActionSurfacingReason | null {
  if (!isProactivelySurfacing(action, now)) {
    return null;
  }
  // A resurfaced deferral never carries a due date, so it is classified first.
  if (action.status === "deferred") {
    return "resurfaced";
  }
  // isProactivelySurfacing guarantees an `open` surfacing action has a due date at or
  // before `now`; the null guard keeps the narrowing honest for the type checker.
  if (action.dueAt === null) {
    return null;
  }
  return startOfLocalDay(action.dueAt) < startOfLocalDay(now) ? "overdue" : "due_today";
}

/**
 * Local-midnight epoch of a date, for whole-day due comparisons. Shared by the
 * surfacing classifier here and the web view layers so "what day is this due" is
 * computed one way everywhere (due dates are stored at local midnight).
 */
export function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * A plain-language cadence label for a Routine — "Every week", "Every 6 months". The
 * canonical phrasing so the UI and, later, Eve describe a Routine's rhythm the same
 * calm way (never streak or pressure language). The unit values are already the
 * singular nouns, so they read directly.
 */
export function describeRecurrence(recurrence: GeneralActionRecurrence): string {
  if (recurrence.interval === 1) {
    return `Every ${recurrence.unit}`;
  }
  return `Every ${recurrence.interval} ${recurrence.unit}s`;
}

/**
 * Guards the invariant that a paused Action is always a Routine: a paused Routine's
 * cadence cannot be removed in place, because that would leave a paused *one-time*
 * Action — a state the model does not allow (pausing is Routine-only). Resume it
 * first, then make it one-time (ADR 0148). A no-op or a cadence *change* while paused
 * is fine; only removal is blocked.
 */
export function assertRecurrenceEditAllowed(
  status: GeneralActionStatus,
  nextRecurrence: GeneralActionRecurrence | null | undefined,
): void {
  if (status === "paused" && nextRecurrence === null) {
    throw new GeneralActionValidationError(
      "Resume this routine before turning it into a one-time action.",
    );
  }
}

/**
 * Edit payload for a General Action's user-facing content. `undefined` leaves a
 * field unchanged; explicit `null` clears an optional field (notes or due date).
 */
export const generalActionEditSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    notes: z.string().nullable().optional(),
    dueAt: z.date().nullable().optional(),
    links: z.array(generalActionLinkSchema).optional(),
    // `undefined` leaves the Area unchanged; explicit `null` unfiles the Action.
    areaId: z.string().nullable().optional(),
    // Asset hints are content, edited in place alongside notes and links (ADR 0156).
    // `undefined` leaves them unchanged; an explicit array replaces the whole set.
    assetHints: z.array(generalActionAssetHintSchema).max(MAX_ASSET_HINTS).optional(),
    // Cadence editing turns an Action into a Routine and back: an object sets or
    // changes the cadence, explicit `null` makes it one-time again, `undefined`
    // leaves it as is (ADR 0148).
    recurrence: generalActionRecurrenceSchema.nullable().optional(),
  })
  .strict();

export type GeneralActionEdit = z.infer<typeof generalActionEditSchema>;

/**
 * Kinds of lifecycle history events tracked for a General Action so Eve and the
 * product can explain what happened and who did it. History without productivity
 * analytics — no scoring, streaks, or predictive prioritization (ADR 0165).
 */
export const generalActionEventKindSchema = z.enum([
  "created",
  "edited",
  "completed",
  "skipped",
  "reopened",
  "deferred",
  "dismissed",
  "archived",
  "paused",
  "resumed",
  // Review-gated history (ADRs 0151, 0152): a proposal was created, promoted into a
  // durable action on acceptance, or quietly set aside (`ignored`). A review dismiss
  // reuses `dismissed`, since a rejected proposal and a dismissed action share the
  // same terminal meaning.
  "suggested",
  "promoted",
  "ignored",
]);

export const generalActionEventSchema = z.object({
  id: z.string(),
  generalActionId: z.string(),
  ownerUserId: z.string(),
  kind: generalActionEventKindSchema,
  // Actor provenance: who performed this lifecycle change (ADR 0154).
  actorUserId: z.string().nullable().default(null),
  detailJson: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.date(),
});

export const createGeneralActionEventSchema = generalActionEventSchema.omit({
  id: true,
  createdAt: true,
});

export type GeneralActionEvent = z.infer<typeof generalActionEventSchema>;
export type GeneralActionEventKind = z.infer<typeof generalActionEventKindSchema>;
export type CreateGeneralActionEventInput = z.input<typeof createGeneralActionEventSchema>;
