import { z } from "zod";
import { sensitivitySchema } from "./privacy";

/**
 * Persisted brief artifact model shared by daily briefs and the weekly
 * relationship review (PRD #65, issue #66, ADR-0008/0044). Daily and weekly
 * briefs are the same artifact: they differ only by cadence, agenda window, item
 * cap, and ranking depth — never by separate tables or lifecycle rules.
 */
export const briefCadenceSchema = z.enum(["daily", "weekly"]);
export type BriefCadence = z.infer<typeof briefCadenceSchema>;

/**
 * Why a brief was generated. Scheduled and manual are first-generation reasons;
 * regenerated marks an explicit, auditable replacement of a current brief
 * (PRD #65, issue #69). The model never silently refreshes a reviewed brief.
 */
export const briefGenerationReasonSchema = z.enum(["scheduled", "manual", "regenerated"]);
export type BriefGenerationReason = z.infer<typeof briefGenerationReasonSchema>;

/**
 * Brief-item lifecycle. These statuses are local to the brief surface and never
 * overload follow-up, source-record, or memory status (PRD #65). Dismiss/snooze
 * clear an item without mutating the underlying record; acted-on records that the
 * user took the real source action (e.g. accepted a suggested follow-up).
 */
export const briefItemStatusSchema = z.enum(["active", "dismissed", "snoozed", "acted_on"]);
export type BriefItemStatus = z.infer<typeof briefItemStatusSchema>;

/**
 * Candidate kinds a brief item can snapshot. These mirror the relationship
 * agenda candidate kinds (the shared read model is the bridge to briefs), but are
 * defined in the domain so brief items do not depend on a db-layer type.
 */
export const briefItemKindSchema = z.enum([
  "due_followup",
  "birthday",
  "review_item",
  "recent_context",
  "semantic_context",
  "suggested_followup",
]);
export type BriefItemKind = z.infer<typeof briefItemKindSchema>;

/** Trust level snapshotted from the agenda candidate (mirrors the agenda read model). */
export const briefItemTrustLevelSchema = z.enum([
  "active_reminder",
  "stored_profile_data",
  "logged_context",
  "confirmed_fact",
  "tentative",
]);
export type BriefItemTrustLevel = z.infer<typeof briefItemTrustLevelSchema>;

/** Source grounding kinds preserved on every brief item (PRD #65). */
export const briefSourceRefKindSchema = z.enum(["followup", "person", "memory", "source_record"]);
export type BriefSourceRefKind = z.infer<typeof briefSourceRefKindSchema>;

export const briefSourceRefSchema = z.object({
  kind: briefSourceRefKindSchema,
  id: z.string(),
});
export type BriefSourceRef = z.infer<typeof briefSourceRefSchema>;

/** Local date the brief covers, formatted YYYY-MM-DD so briefs align with the user's day, not UTC. */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Local date must be formatted YYYY-MM-DD.");

/**
 * A persisted brief record. The summary line is optional decorative presentation
 * text (PRD #65, issue #73); it never selects, ranks, or grounds items.
 * `supersededAt` is set when an explicit regeneration replaces this brief — prior
 * briefs stay persisted and internally queryable for feedback and audit.
 */
export const briefSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  cadence: briefCadenceSchema,
  localDate: localDateSchema,
  generationReason: briefGenerationReasonSchema,
  generatedAt: z.date(),
  windowStart: z.date(),
  windowEnd: z.date(),
  // Optional decorative summary line; null when absent or when summary generation
  // failed open (PRD #65, issue #73).
  summary: z.string().nullable().default(null),
  // Narrow provenance for the decorative summary only (model/adapter id, etc.).
  summaryProvenance: z.record(z.string(), z.unknown()).nullable().default(null),
  // Set when an explicit regeneration supersedes this brief; null for the current brief.
  supersededAt: z.date().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Brief = z.infer<typeof briefSchema>;

/**
 * A persisted brief item: a snapshot of the agenda candidate shown to the user.
 * Render-time code reads these fields and never recomputes title, reason, or rank
 * from the live agenda query (PRD #65).
 */
export const briefItemSchema = z.object({
  id: z.string(),
  briefId: z.string(),
  ownerUserId: z.string(),
  kind: briefItemKindSchema,
  personId: z.string().nullable().default(null),
  personDisplayName: z.string().nullable().default(null),
  title: z.string().min(1),
  reason: z.string(),
  dueAt: z.date().nullable().default(null),
  sourceRefs: z.array(briefSourceRefSchema).default([]),
  trustLevel: briefItemTrustLevelSchema,
  sensitivity: sensitivitySchema,
  rank: z.number().int(),
  status: briefItemStatusSchema.default("active"),
  // When the item is snoozed, the moment the snooze expires and the candidate may
  // surface again (PRD #65, issue #68). Null unless snoozed.
  snoozedUntil: z.date().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type BriefItem = z.infer<typeof briefItemSchema>;

export const createBriefItemSchema = briefItemSchema.omit({
  id: true,
  briefId: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateBriefItemInput = z.infer<typeof createBriefItemSchema>;

export const createBriefSchema = briefSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ items: z.array(createBriefItemSchema).default([]) });
export type CreateBriefInput = z.infer<typeof createBriefSchema>;

/** A brief with its persisted item snapshots, the unit most callers read. */
export type BriefWithItems = Brief & { items: BriefItem[] };

/**
 * Explicit brief-item lifecycle transitions. This is the single validated matrix
 * so web and schedule callers cannot make invalid jumps. `act` marks a real
 * source action taken (e.g. an accepted suggested follow-up, issue #71); dismiss
 * and snooze clear the item locally without touching the underlying record.
 */
export type BriefItemAction = "dismiss" | "snooze" | "act";

const BRIEF_ITEM_TRANSITIONS: Record<
  BriefItemAction,
  { from: ReadonlySet<BriefItemStatus>; to: BriefItemStatus }
> = {
  dismiss: { from: new Set(["active", "snoozed"]), to: "dismissed" },
  snooze: { from: new Set(["active", "snoozed"]), to: "snoozed" },
  act: { from: new Set(["active", "snoozed"]), to: "acted_on" },
};

export function resolveBriefItemTransition(
  current: BriefItemStatus,
  action: BriefItemAction,
): BriefItemStatus {
  const rule = BRIEF_ITEM_TRANSITIONS[action];

  if (!rule.from.has(current)) {
    throw new Error(`Cannot ${action} a brief item that is ${current}.`);
  }

  return rule.to;
}

/**
 * Whether a prior brief item still represents cleared feedback that should
 * suppress a matching candidate during (re)generation (PRD #65, issue #68,
 * ADR-0008): dismissed and acted-on are durable, a snooze suppresses only until
 * it expires. Active items are not feedback — the candidate may legitimately
 * reappear.
 */
export function isBriefItemFeedbackActive(
  item: Pick<BriefItem, "status" | "snoozedUntil">,
  now: Date,
): boolean {
  if (item.status === "dismissed" || item.status === "acted_on") {
    return true;
  }

  if (item.status === "snoozed") {
    return item.snoozedUntil === null || item.snoozedUntil.getTime() > now.getTime();
  }

  return false;
}

/**
 * Stable keys identifying the candidate a brief item came from, used to match a
 * new agenda candidate against prior feedback (PRD #65, issue #68). Each key binds
 * kind, person, and a single source reference together, so two items "match" only
 * when they share the same kind, the same person, and at least one source
 * reference — the conjunctive rule ADR-0008 states ("same source references,
 * person, and kind"). This is deliberately stricter than the agenda's
 * kind-agnostic dedupe: a different follow-up for the same person (a distinct
 * source reference) is a genuinely new prompt and is not suppressed.
 */
export function briefItemIdentityKeys(input: {
  kind: BriefItemKind;
  personId: string | null;
  sourceRefs: BriefSourceRef[];
}): string[] {
  const person = input.personId ?? "";

  return input.sourceRefs.map(
    (ref) => `${input.kind}|person:${person}|source:${ref.kind}:${ref.id}`,
  );
}
