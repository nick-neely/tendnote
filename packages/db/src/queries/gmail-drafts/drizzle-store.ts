import { type GmailDraftAction, gmailDraftActionSchema } from "@tendnote/domain";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { auditLog, gmailDraftActions } from "../../schema";
import type { GmailDraftActionStore } from "./types";

type GmailDraftActionRow = typeof gmailDraftActions.$inferSelect;

function rowToAction(row: GmailDraftActionRow): GmailDraftAction {
  return gmailDraftActionSchema.parse({
    id: row.id,
    ownerUserId: row.ownerUserId,
    messageDraftId: row.messageDraftId,
    providerKey: row.providerKey,
    capabilityKey: row.capabilityKey,
    kind: row.kind,
    status: row.status,
    subject: row.subject,
    recipient: {
      email: row.recipientEmail,
      source: row.recipientSource,
      contactMethodId: row.recipientContactMethodId,
    },
    gmailDraftId: row.gmailDraftId,
    version: row.version,
    idempotencyKey: row.idempotencyKey,
    lastErrorMessage: row.lastErrorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Drizzle-backed Gmail draft action store. Persists minimized non-secret provider
 * state only (ADR-0094): the recipient is flattened into scalar columns, the body
 * never lands here, and there is no raw-payload column.
 */
export function createDrizzleGmailDraftActionStore(): GmailDraftActionStore {
  return {
    async createAction(values) {
      const [row] = await getDb()
        .insert(gmailDraftActions)
        .values({
          ownerUserId: values.ownerUserId,
          messageDraftId: values.messageDraftId,
          providerKey: values.providerKey,
          capabilityKey: values.capabilityKey,
          kind: values.kind,
          status: values.status,
          subject: values.subject,
          recipientEmail: values.recipient.email,
          recipientSource: values.recipient.source,
          recipientContactMethodId: values.recipient.contactMethodId,
          gmailDraftId: values.gmailDraftId,
          version: values.version,
          idempotencyKey: values.idempotencyKey,
          lastErrorMessage: values.lastErrorMessage,
        })
        .returning();

      if (!row) {
        throw new Error("Failed to create Gmail draft action.");
      }

      return rowToAction(row);
    },

    async getAction({ ownerUserId, actionId }) {
      const [row] = await getDb()
        .select()
        .from(gmailDraftActions)
        .where(
          and(eq(gmailDraftActions.id, actionId), eq(gmailDraftActions.ownerUserId, ownerUserId)),
        )
        .limit(1);

      return row ? rowToAction(row) : null;
    },

    async updateAction({ ownerUserId, actionId, patch }) {
      const [row] = await getDb()
        .update(gmailDraftActions)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(gmailDraftActions.id, actionId), eq(gmailDraftActions.ownerUserId, ownerUserId)),
        )
        .returning();

      return row ? rowToAction(row) : null;
    },

    async listActionsForDraft({ ownerUserId, messageDraftId }) {
      const rows = await getDb()
        .select()
        .from(gmailDraftActions)
        .where(
          and(
            eq(gmailDraftActions.ownerUserId, ownerUserId),
            eq(gmailDraftActions.messageDraftId, messageDraftId),
          ),
        )
        .orderBy(desc(gmailDraftActions.createdAt));

      return rows.map(rowToAction);
    },

    async findByIdempotencyKey({ ownerUserId, idempotencyKey }) {
      const [row] = await getDb()
        .select()
        .from(gmailDraftActions)
        .where(
          and(
            eq(gmailDraftActions.ownerUserId, ownerUserId),
            eq(gmailDraftActions.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);

      return row ? rowToAction(row) : null;
    },

    async createAuditLogEntry(values) {
      await getDb().insert(auditLog).values(values);
    },
  };
}
