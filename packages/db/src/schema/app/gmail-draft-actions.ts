import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import { messageDrafts } from "./engagement";
import { gmailDraftActionKind, gmailDraftActionStatus, gmailDraftRecipientSource } from "./enums";

/**
 * Durable Gmail draft action records (Phase 2D, PRD #119, ADR-0084, ADR-0094).
 *
 * Each row is one owner-scoped external-write attempt that externalizes an
 * approved, source-grounded Tendnote `message_drafts` row into a Gmail draft
 * (ADR-0083). Records make external draft creation/update explainable, idempotent,
 * and recoverable without depending on audit logs alone.
 *
 * MINIMIZED, NON-SECRET STATE ONLY (ADR-0094). The message body is intentionally
 * NOT stored here — it stays on `message_drafts` (ADR-0086) — and there are no
 * columns for raw Gmail API payloads, mailbox labels, thread metadata, message
 * history, OAuth tokens, or provider dumps. The recipient is a single confirmed
 * `to` address; CC, BCC, and attachments are deferred (ADR-0095).
 */
export const gmailDraftActions = pgTable(
  "gmail_draft_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The source-grounded Tendnote draft this external write externalizes. Cascade
    // delete keeps external-action history from outliving its source draft.
    messageDraftId: uuid("message_draft_id")
      .notNull()
      .references(() => messageDrafts.id, { onDelete: "cascade" }),
    // Provider connection identity (matches provider_connections' generic keys):
    // always google/gmail in Phase 2D, but carried explicitly so the record is
    // self-describing and future providers reuse the shape.
    providerKey: text("provider_key").notNull(),
    capabilityKey: text("capability_key").notNull(),
    kind: gmailDraftActionKind("kind").notNull(),
    status: gmailDraftActionStatus("status").notNull(),
    // Approved subject persisted before the external write (ADR-0087).
    subject: text("subject").notNull(),
    // Confirmed External Draft Recipient metadata (ADR-0085). A manual entry is
    // action-specific and is never promoted to a durable contact method here; a
    // contact-method address records which saved method it came from.
    recipientEmail: text("recipient_email").notNull(),
    recipientSource: gmailDraftRecipientSource("recipient_source").notNull(),
    recipientContactMethodId: uuid("recipient_contact_method_id"),
    // The external Gmail draft id; null until a create succeeds (ADR-0084). Later
    // approved updates target this id rather than creating a duplicate draft.
    gmailDraftId: text("gmail_draft_id"),
    // Monotonic action/version metadata across a draft's external-write history.
    version: integer("version").notNull().default(1),
    // Dedupes retried/refreshed submissions so a refresh never creates a duplicate
    // external draft (PRD story 38); unique per owner.
    idempotencyKey: text("idempotency_key").notNull(),
    // Non-secret provider/transient error for visible retry; never a raw payload.
    lastErrorMessage: text("last_error_message"),
    ...timestamps,
  },
  (table) => [
    index("gmail_draft_actions_owner_user_id_idx").on(table.ownerUserId),
    index("gmail_draft_actions_message_draft_id_idx").on(table.messageDraftId),
    uniqueIndex("gmail_draft_actions_owner_idempotency_idx").on(
      table.ownerUserId,
      table.idempotencyKey,
    ),
  ],
);
