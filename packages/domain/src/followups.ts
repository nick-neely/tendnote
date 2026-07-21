import { z } from "zod";
import { privacyScopeSchema } from "./privacy";

export const followupStatusSchema = z.enum([
  "suggested",
  "open",
  "snoozed",
  "completed",
  "dismissed",
  "archived",
]);

export const followupSchema = z.object({
  id: z.string(),
  personId: z.string(),
  ownerUserId: z.string(),
  reason: z.string().min(1),
  dueAt: z.date(),
  status: followupStatusSchema.default("open"),
  cadence: z.string().nullable().optional(),
  // Grounding for a suggested follow-up or an explicit source-first Capture.
  // Ordinary manually-created active reminders may remain ungrounded.
  sourceRecordId: z.string().nullable().optional(),
  lastPromptedAt: z.date().nullable().optional(),
  householdId: z.string().nullable().default(null),
  scope: privacyScopeSchema.default("private"),
  createdByUserId: z.string().nullable().optional(),
  lastActorUserId: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createFollowupSchema = followupSchema
  .omit({
    createdAt: true,
    updatedAt: true,
  })
  .extend({ id: z.uuid().optional() });

export type Followup = z.infer<typeof followupSchema>;
export type FollowupStatus = z.infer<typeof followupStatusSchema>;
export type CreateFollowupInput = z.input<typeof createFollowupSchema>;

/**
 * Validates a bounded update patch for a persisted follow-up. Deliberately carries
 * **no defaults** — unlike `followupSchema.partial()`, an absent key stays absent
 * instead of being filled. A partial of the base schema would inject `status: open`,
 * `scope: private`, and `householdId: null` for keys the caller never set, silently
 * resetting a snoozed follow-up to open and wiping a shared follow-up's scope and
 * household on every lifecycle change. A store that sets only the returned keys must
 * use this schema, not a partial of the base one.
 */
export const followupUpdateSchema = z
  .object({
    reason: z.string().min(1),
    dueAt: z.date(),
    status: followupStatusSchema,
    cadence: z.string().nullable(),
    sourceRecordId: z.string().nullable(),
    lastPromptedAt: z.date().nullable(),
    householdId: z.string().nullable(),
    scope: privacyScopeSchema,
    createdByUserId: z.string().nullable(),
    lastActorUserId: z.string().nullable(),
  })
  .partial();

export type FollowupUpdate = z.infer<typeof followupUpdateSchema>;

/**
 * Statuses that count as active relationship reminders the user still owes. The
 * snapshot read path and dashboard/profile surfaces treat these — and only these
 * — as "active" follow-ups (PRD #42, #16).
 */
export const ACTIVE_FOLLOWUP_STATUSES: ReadonlySet<FollowupStatus> = new Set(["open", "snoozed"]);

export function isActiveFollowupStatus(status: FollowupStatus): boolean {
  return ACTIVE_FOLLOWUP_STATUSES.has(status);
}

/**
 * Statuses a follow-up's reason or due date may still be edited from. Editing a
 * completed, dismissed, or archived follow-up is rejected — those are terminal
 * for content edits; the user reopens first (PRD #42).
 */
export const EDITABLE_FOLLOWUP_STATUSES: ReadonlySet<FollowupStatus> = new Set([
  "suggested",
  "open",
  "snoozed",
]);

/**
 * Explicit follow-up lifecycle transitions. This is the single validated matrix
 * for the whole Phase 1E lifecycle (PRD #42 enumerates create, edit, complete,
 * dismiss, snooze, reopen, archive, and accept-suggestion), so callers (web and
 * Eve) cannot make invalid status jumps (ADR-0007). `accept` promotes a reviewed
 * suggestion to an active reminder; its service method and the suggested-review
 * surfaces arrive with the suggested-follow-up slice (#47), while the active
 * reminder service methods (#43) cover the rest.
 */
export type FollowupLifecycleAction =
  | "accept"
  | "complete"
  | "dismiss"
  | "snooze"
  | "reopen"
  | "archive";

const FOLLOWUP_TRANSITIONS: Record<
  FollowupLifecycleAction,
  { from: ReadonlySet<FollowupStatus>; to: FollowupStatus }
> = {
  // A reviewed suggestion becomes an active reminder only on explicit accept.
  accept: { from: new Set(["suggested"]), to: "open" },
  complete: { from: new Set(["open", "snoozed"]), to: "completed" },
  // Suggested follow-ups are dismissed through the review path; active ones from
  // the reminder surface. Both land in the same terminal state.
  dismiss: { from: new Set(["suggested", "open", "snoozed"]), to: "dismissed" },
  snooze: { from: new Set(["open", "snoozed"]), to: "snoozed" },
  reopen: { from: new Set(["completed", "dismissed"]), to: "open" },
  // Archive preserves history while removing a follow-up from normal views. It is
  // reachable from any non-archived state (ADR-0024-style soft removal).
  archive: {
    from: new Set(["suggested", "open", "snoozed", "completed", "dismissed"]),
    to: "archived",
  },
};

/**
 * Resolves the target status for a lifecycle action, rejecting invalid jumps with
 * a clear error. This is the single place the allowed transitions live so web and
 * Eve cannot fork the rules (PRD #42).
 */
export function resolveFollowupTransition(
  current: FollowupStatus,
  action: FollowupLifecycleAction,
): FollowupStatus {
  const rule = FOLLOWUP_TRANSITIONS[action];

  if (!rule.from.has(current)) {
    throw new Error(`Cannot ${action} a follow-up that is ${current}.`);
  }

  return rule.to;
}

export function assertFollowupEditable(status: FollowupStatus): void {
  if (!EDITABLE_FOLLOWUP_STATUSES.has(status)) {
    throw new Error(`Cannot edit a follow-up that is ${status}.`);
  }
}

/**
 * Guards that a follow-up has a concrete due date. Phase 1E refuses vague
 * "someday" reminders, so creation, snooze, and edits all run their proposed due
 * date through this before persisting (PRD #42, ADR-0042).
 */
export function assertConcreteDueAt(dueAt: unknown): Date {
  if (!(dueAt instanceof Date) || Number.isNaN(dueAt.getTime())) {
    throw new Error("A follow-up needs a concrete due date.");
  }

  return dueAt;
}

/** Edit payload for a follow-up's user-facing fields (reason and/or due date). */
export const followupEditSchema = z
  .object({
    reason: z.string().min(1).optional(),
    dueAt: z.date().optional(),
  })
  .strict();

export type FollowupEdit = z.infer<typeof followupEditSchema>;
