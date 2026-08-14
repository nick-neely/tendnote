import { z } from "zod";

export const messageDraftChannelSchema = z.enum(["text", "email", "slack", "other"]);

export const messageDraftPurposeSchema = z.enum([
  "birthday",
  "thank_you",
  "check_in",
  "networking",
  "other",
]);

export const messageDraftStatusSchema = z.enum(["draft", "approved", "dismissed", "sent_manually"]);

/**
 * A message-draft refusal the caller can act on, written for a person.
 *
 * The lifecycle's state refusals - editing a draft the user already dismissed or
 * sent, approving one that is no longer a draft, saving an empty or unchanged
 * body - are all facts about the user's own record and all fixable by the user.
 * They threw a bare `Error` until now, which the surfaces that guard against
 * leaking infrastructure text (`apps/agent/agent/lib/store-errors.ts`) correctly
 * cannot tell apart from a Drizzle failure, so Eve answered "could not read the
 * user's records right now" for "you already sent that one". This class is the
 * signal those allowlists read.
 *
 * Deliberately NOT used for "Message draft not found": a missing record is
 * exactly the failure that taught Eve to guess a different id and call again, and
 * the opaque store sentence is the one that terminates that loop.
 */
export class MessageDraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageDraftValidationError";
  }
}

/**
 * Source grounding kinds preserved on every generated Tendnote draft (PRD #75,
 * issue #76, ADR-0040). These mirror the context trust tiers (ADR-0004): approved
 * memories are confirmed facts, source records are logged context, suggested
 * memories are tentative hints, and follow-ups and brief items are the
 * intent/entry-point that started the draft. Persisted references are the
 * grounding contract — the draft body is editable prose, but the references stay
 * stable so a draft can be reviewed, explained, tested, and audited after
 * generation even if the underlying memory or note later changes.
 */
export const draftSourceRefKindSchema = z.enum([
  "approved_memory",
  "source_record",
  "suggested_memory",
  "followup",
  "brief_item",
]);
export type DraftSourceRefKind = z.infer<typeof draftSourceRefKindSchema>;

/** Trust tier a draft source reference contributes to phrasing (ADR-0004). */
export const draftSourceRefTrustSchema = z.enum([
  "confirmed_fact",
  "logged_context",
  "tentative",
  "intent",
  "entry_point",
]);
export type DraftSourceRefTrust = z.infer<typeof draftSourceRefTrustSchema>;

/**
 * A single persisted draft source reference. `id` identifies the grounding record
 * but is never user-facing copy; `label` is a short snapshot of the record so the
 * review UI and Eve can render the grounding without re-resolving (or exposing)
 * raw ids. The trust tier is snapshotted so phrasing stays explainable even if
 * the underlying record's status later changes.
 */
/** The trust tier each draft source-reference kind contributes (ADR-0004). */
export function draftSourceRefTrustForKind(kind: DraftSourceRefKind): DraftSourceRefTrust {
  switch (kind) {
    case "approved_memory":
      return "confirmed_fact";
    case "source_record":
      return "logged_context";
    case "suggested_memory":
      return "tentative";
    case "followup":
      return "intent";
    case "brief_item":
      return "entry_point";
  }
}

export const draftSourceRefSchema = z
  .object({
    kind: draftSourceRefKindSchema,
    id: z.string().min(1),
    label: z.string().min(1),
    trust: draftSourceRefTrustSchema,
  })
  // Trust is snapshotted so phrasing stays explainable, but it must agree with the
  // kind's canonical tier (ADR-0004): an `approved_memory` is always a confirmed
  // fact, a `suggested_memory` always tentative. Rejecting mismatches keeps Eve
  // and the review UI from rendering an inconsistent grounding snapshot.
  .refine((ref) => ref.trust === draftSourceRefTrustForKind(ref.kind), {
    message: "Draft source reference trust must match its kind's canonical trust tier.",
    path: ["trust"],
  });
export type DraftSourceRef = z.infer<typeof draftSourceRefSchema>;

export const messageDraftSchema = z.object({
  id: z.string(),
  personId: z.string(),
  ownerUserId: z.string(),
  channel: messageDraftChannelSchema.default("text"),
  purpose: messageDraftPurposeSchema.default("other"),
  body: z.string().min(1),
  status: messageDraftStatusSchema.default("draft"),
  // The grounding contract for the draft (PRD #75, issue #76). Snapshotted at
  // generation time so the draft stays explainable after the underlying records
  // change. Empty only for legacy/manual drafts created without grounding.
  sourceRefs: z.array(draftSourceRefSchema).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createMessageDraftSchema = messageDraftSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MessageDraft = z.infer<typeof messageDraftSchema>;
export type MessageDraftChannel = z.infer<typeof messageDraftChannelSchema>;
export type MessageDraftPurpose = z.infer<typeof messageDraftPurposeSchema>;
export type MessageDraftStatus = z.infer<typeof messageDraftStatusSchema>;
export type CreateMessageDraftInput = z.infer<typeof createMessageDraftSchema>;

/**
 * Explicit draft lifecycle transitions (PRD #75, issue #78, ADR-0014). This is the
 * single validated matrix so web and Eve callers cannot make invalid jumps. All
 * transitions are internal to Tendnote: `mark_sent_manually` records that the user
 * sent the message themselves — it never implies Tendnote sent anything (PRD user
 * story #10), and `approve` is internal readiness only, not an external send.
 */
export type MessageDraftAction = "approve" | "dismiss" | "mark_sent_manually";

const MESSAGE_DRAFT_TRANSITIONS: Record<
  MessageDraftAction,
  { from: ReadonlySet<MessageDraftStatus>; to: MessageDraftStatus }
> = {
  approve: { from: new Set(["draft"]), to: "approved" },
  dismiss: { from: new Set(["draft", "approved"]), to: "dismissed" },
  mark_sent_manually: { from: new Set(["draft", "approved"]), to: "sent_manually" },
};

export function resolveMessageDraftTransition(
  current: MessageDraftStatus,
  action: MessageDraftAction,
): MessageDraftStatus {
  const rule = MESSAGE_DRAFT_TRANSITIONS[action];

  if (!rule.from.has(current)) {
    throw new MessageDraftValidationError(`Cannot ${action} a draft that is ${current}.`);
  }

  return rule.to;
}

/** A draft body is editable only while it is still active (draft or approved). */
export function assertMessageDraftEditable(status: MessageDraftStatus): void {
  if (status !== "draft" && status !== "approved") {
    throw new MessageDraftValidationError(`Cannot edit a draft that is ${status}.`);
  }
}
