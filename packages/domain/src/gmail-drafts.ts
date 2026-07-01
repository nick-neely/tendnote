import { z } from "zod";
import type { MessageDraftPurpose } from "./drafts";

/**
 * Gmail draft externalization vocabulary (Phase 2D, PRD #119, ADRs 0083–0097).
 *
 * A Gmail draft action is a durable, owner-scoped external-write record that
 * externalizes an already source-grounded Tendnote `message_drafts` row into a
 * Gmail draft (ADR-0083, ADR-0084). The record stores only MINIMIZED, non-secret
 * provider state (ADR-0094): the Tendnote draft id, the Gmail draft id when the
 * write succeeds, status, the approved subject, confirmed recipient metadata,
 * provider/capability identity, action/version metadata, and non-secret errors.
 * The message body stays on the Tendnote draft row and is NEVER duplicated here,
 * and raw Gmail API payloads, mailbox labels, thread metadata, and message
 * history are never persisted.
 */

/** Gmail is a `google/gmail` provider capability, distinct from `google/calendar`. */
export const GMAIL_PROVIDER_KEY = "google";
export const GMAIL_CAPABILITY_KEY = "gmail";

/**
 * The single narrow Google scope Phase 2D Gmail draft writes request (ADR-0090,
 * ADR-0095): create and update drafts. `gmail.compose` is the narrowest scope that
 * supports `users.drafts.create`/`users.drafts.update`; Phase 2D deliberately does
 * NOT request `gmail.readonly`, `gmail.modify`, history, or full-mailbox scopes.
 *
 * No-send is enforced structurally, not by scope: Tendnote's Gmail adapter exposes
 * only draft create/update and has no send path (ADR-0089, PRD out-of-scope), so a
 * created draft never contacts another person.
 */
export const GOOGLE_GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

/** Whether a granted-scope list includes the Gmail draft-write scope. */
export function hasGmailComposeScope(scopes: readonly string[]): boolean {
  return scopes.includes(GOOGLE_GMAIL_COMPOSE_SCOPE);
}

/** A Gmail draft action either creates a new draft or updates an existing one. */
export const gmailDraftActionKindSchema = z.enum(["create", "update"]);
export type GmailDraftActionKind = z.infer<typeof gmailDraftActionKindSchema>;

/**
 * Durable outcome persisted on a Gmail draft action record.
 *
 * - `succeeded`: the provider create/update returned, and the Gmail draft id is
 *   stored (last known external state, ADR-0089).
 * - `failed`: the write failed transiently; the non-secret error is recorded and
 *   the action is retryable through explicit visible retry (ADR-0091). There is no
 *   background retry.
 *
 * A precondition failure (Gmail not connected, missing approval, duplicate create)
 * is a `blocked` service OUTCOME, not a stored status — no external draft exists
 * and nothing is retryable at the action level, so no durable row is written.
 */
export const gmailDraftActionStatusSchema = z.enum(["succeeded", "failed"]);
export type GmailDraftActionStatus = z.infer<typeof gmailDraftActionStatusSchema>;

/**
 * Where a confirmed recipient address came from (ADR-0085). A `manual_entry`
 * address is action-specific External Draft Recipient metadata and is NEVER
 * silently saved as a durable person contact method; a `contact_method` address
 * references an already-saved contact method.
 */
export const gmailDraftRecipientSourceSchema = z.enum(["contact_method", "manual_entry"]);
export type GmailDraftRecipientSource = z.infer<typeof gmailDraftRecipientSourceSchema>;

/**
 * Confirmed `to` recipient for a Gmail draft (ADR-0085, ADR-0095). The first slice
 * supports a single `to` address only — no CC, BCC, or attachments (ADR-0095).
 */
export const gmailDraftRecipientSchema = z
  .object({
    email: z.string().trim().min(3).max(320).pipe(z.email()),
    source: gmailDraftRecipientSourceSchema,
    /**
     * The saved contact method the address came from, when `source` is
     * `contact_method`. Null for a manually entered address so a draft action can
     * never masquerade as contact import or profile enrichment (ADR-0085).
     */
    contactMethodId: z.string().min(1).nullable().default(null),
  })
  .refine(
    (recipient) =>
      recipient.source === "contact_method"
        ? recipient.contactMethodId !== null
        : recipient.contactMethodId === null,
    {
      message:
        "A contact-method recipient must reference a contact method id; a manual entry must not.",
      path: ["contactMethodId"],
    },
  );
export type GmailDraftRecipient = z.infer<typeof gmailDraftRecipientSchema>;

/**
 * An approved Gmail subject (ADR-0087). Required and non-empty: Gmail drafts are
 * intentional and inspectable. Capped below the RFC 2822 unfolded header limit.
 */
export const gmailDraftSubjectSchema = z.string().trim().min(1).max(988);

/**
 * Full persisted Gmail draft action record. Every field is minimized non-secret
 * state (ADR-0094); the message body is intentionally absent (it lives on the
 * Tendnote `message_drafts` row).
 */
export const gmailDraftActionSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  /** The source-grounded Tendnote draft this external write externalizes. */
  messageDraftId: z.string(),
  providerKey: z.string(),
  capabilityKey: z.string(),
  kind: gmailDraftActionKindSchema,
  status: gmailDraftActionStatusSchema,
  subject: gmailDraftSubjectSchema,
  recipient: gmailDraftRecipientSchema,
  /** The external Gmail draft id; null until a create succeeds (ADR-0084). */
  gmailDraftId: z.string().min(1).nullable(),
  /** Monotonic action/version metadata for the draft's external-write history. */
  version: z.number().int().positive(),
  /** Idempotency key that dedupes retried/refreshed submissions (PRD story 38). */
  idempotencyKey: z.string().min(1).max(200),
  /** Non-secret provider/transient error; never a raw payload (ADR-0094). */
  lastErrorMessage: z.string().max(1000).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type GmailDraftAction = z.infer<typeof gmailDraftActionSchema>;

/**
 * A deterministic suggested Gmail subject from the Tendnote draft's purpose and the
 * person's name (ADR-0087, ADR-0097). This is a low-friction starting point the user
 * edits/approves before the write — it is NOT model-backed generation, so Phase 2D
 * adds no new model eval. The suggestion never invents relationship facts; it only
 * frames the known purpose. Callers must still let the user edit and approve it.
 */
export function suggestGmailSubject(input: {
  purpose: MessageDraftPurpose;
  personName?: string | null;
}): string {
  const name = input.personName?.trim();
  const withName = (base: string) => (name ? `${base}, ${name}` : base);
  switch (input.purpose) {
    case "birthday":
      return name ? `Happy birthday, ${name}!` : "Happy birthday!";
    case "thank_you":
      return withName("Thank you");
    case "check_in":
      return withName("Checking in");
    case "networking":
      return withName("Great connecting");
    default:
      return name ? `Hello, ${name}` : "Hello";
  }
}

/** Validated input for approving a Gmail draft write (subject + recipient). */
export const gmailDraftApprovalSchema = z.object({
  subject: gmailDraftSubjectSchema,
  recipient: gmailDraftRecipientSchema,
});
export type GmailDraftApproval = z.infer<typeof gmailDraftApprovalSchema>;
