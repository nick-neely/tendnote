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
 * The review-gated `suggested` state and recurring-Routine states are deferred to
 * later Phase 5 slices; adding enum values is additive so this stays forward
 * friendly (ADRs 0144, 0147, 0148).
 */
export const generalActionStatusSchema = z.enum([
  "open",
  "deferred",
  "completed",
  "dismissed",
  "archived",
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
  // Visibility scope. Phase 5 #178 is private-only; the column is present so
  // shared/household scopes can be added additively (#180, ADR 0153).
  scope: privacyScopeSchema.default("private"),
  householdId: z.string().nullable().default(null),
  // Creator provenance and actor provenance for lifecycle changes (ADR 0154).
  createdByUserId: z.string().nullable().optional(),
  lastActorUserId: z.string().nullable().optional(),
  completedAt: z.date().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createGeneralActionSchema = generalActionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

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
    status: generalActionStatusSchema,
    dueAt: z.date().nullable(),
    deferUntil: z.date().nullable(),
    areaId: z.string().nullable(),
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
 * Statuses a General Action's content (title, notes, links, due date) may still be
 * edited from. Editing a completed, dismissed, or archived action is rejected —
 * those are terminal for content edits; the user reopens first (ADR 0165).
 */
export const EDITABLE_GENERAL_ACTION_STATUSES: ReadonlySet<GeneralActionStatus> = new Set([
  "open",
  "deferred",
]);

/**
 * Explicit General Action lifecycle transitions. This is the single validated
 * matrix for the whole one-time action lifecycle so callers (web and, later, Eve)
 * cannot make invalid status jumps. Mirrors the Follow-Up lifecycle matrix while
 * staying a separate model (ADR 0143).
 */
export type GeneralActionLifecycleAction = "complete" | "defer" | "dismiss" | "reopen" | "archive";

const GENERAL_ACTION_TRANSITIONS: Record<
  GeneralActionLifecycleAction,
  { from: ReadonlySet<GeneralActionStatus>; to: GeneralActionStatus }
> = {
  complete: { from: new Set(["open", "deferred"]), to: "completed" },
  defer: { from: new Set(["open", "deferred"]), to: "deferred" },
  dismiss: { from: new Set(["open", "deferred"]), to: "dismissed" },
  reopen: { from: new Set(["completed", "dismissed"]), to: "open" },
  // Archive preserves history while removing an action from active views. It is
  // reachable from any non-archived state.
  archive: {
    from: new Set(["open", "deferred", "completed", "dismissed"]),
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
  "reopened",
  "deferred",
  "dismissed",
  "archived",
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
