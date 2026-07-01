import { randomUUID } from "node:crypto";
import { type GmailDraftAction, gmailDraftActionSchema } from "@tendnote/domain";
import type {
  GmailDraftActionStore,
  GmailDraftAuditLogEntry,
  PersistGmailDraftActionInput,
} from "./types";

export type InMemoryGmailDraftActionStore = GmailDraftActionStore & {
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<GmailDraftAuditLogEntry[]>;
};

/**
 * In-memory Gmail draft action store over one map. Exercises owner scoping,
 * idempotency, and minimized persistence in tests without a database. Every read
 * and write is owner-scoped by construction.
 */
export function createInMemoryGmailDraftActionStore(): InMemoryGmailDraftActionStore {
  const actions = new Map<string, GmailDraftAction>();
  const auditLogEntries: GmailDraftAuditLogEntry[] = [];

  function persist(values: PersistGmailDraftActionInput): GmailDraftAction {
    const now = new Date();
    return gmailDraftActionSchema.parse({
      ...values,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    async createAction(values) {
      const action = persist(values);
      actions.set(action.id, action);
      return action;
    },

    async getAction({ ownerUserId, actionId }) {
      const action = actions.get(actionId);
      if (!action || action.ownerUserId !== ownerUserId) {
        return null;
      }
      return action;
    },

    async updateAction({ ownerUserId, actionId, patch }) {
      const action = actions.get(actionId);
      if (!action || action.ownerUserId !== ownerUserId) {
        return null;
      }
      const updated = gmailDraftActionSchema.parse({ ...action, ...patch, updatedAt: new Date() });
      actions.set(updated.id, updated);
      return updated;
    },

    async listActionsForDraft({ ownerUserId, messageDraftId }) {
      return [...actions.values()]
        .filter(
          (action) =>
            action.ownerUserId === ownerUserId && action.messageDraftId === messageDraftId,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    async findByIdempotencyKey({ ownerUserId, idempotencyKey }) {
      return (
        [...actions.values()].find(
          (action) =>
            action.ownerUserId === ownerUserId && action.idempotencyKey === idempotencyKey,
        ) ?? null
      );
    },

    async createAuditLogEntry(entry) {
      auditLogEntries.push(entry);
    },

    async listAuditLogEntries({ ownerUserId }) {
      return auditLogEntries.filter((entry) => entry.ownerUserId === ownerUserId);
    },
  };
}
