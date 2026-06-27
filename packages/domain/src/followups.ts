import { z } from "zod";

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
  // Grounding for a suggested follow-up: the source record (logged context,
  // captured conversation, or a record standing in for an approved memory or
  // retrieval result) the suggestion was proposed from. Null for user-created
  // active reminders, which need no grounding (PRD #42, ADR-0006).
  sourceRecordId: z.string().nullable().optional(),
  lastPromptedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createFollowupSchema = followupSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Followup = z.infer<typeof followupSchema>;
export type FollowupStatus = z.infer<typeof followupStatusSchema>;
export type CreateFollowupInput = z.infer<typeof createFollowupSchema>;

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
