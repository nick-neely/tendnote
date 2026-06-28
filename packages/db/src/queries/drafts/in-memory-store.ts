import { randomUUID } from "node:crypto";
import { createMessageDraftSchema, type MessageDraft, messageDraftSchema } from "@tendnote/domain";
import { createInMemorySourceRecordStore } from "../source-records/in-memory-store";
import type { DraftStore, InMemoryDraftLifecycleStore } from "./types";

/**
 * Minimal draft persistence over one map. Source references travel with the draft
 * so owner scoping and grounding are exercised in tests without a database. It
 * carries only draft methods so it can be spread into the composed lifecycle
 * store without shadowing person/source/audit methods (mirrors the brief store).
 */
export function createInMemoryDraftStore(): DraftStore {
  const drafts = new Map<string, MessageDraft>();

  return {
    async createDraft(input) {
      const parsed = createMessageDraftSchema.parse(input);
      const now = new Date();
      const draft: MessageDraft = messageDraftSchema.parse({
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      drafts.set(draft.id, draft);

      return draft;
    },
    async getDraft(input) {
      const draft = drafts.get(input.draftId);

      if (!draft || draft.ownerUserId !== input.ownerUserId) {
        return null;
      }

      return draft;
    },
    async listDraftsForPerson(input) {
      return [...drafts.values()]
        .filter(
          (draft) =>
            draft.ownerUserId === input.ownerUserId &&
            draft.personId === input.personId &&
            (input.statuses === undefined || input.statuses.includes(draft.status)),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async listDraftsForOwner(input) {
      return [...drafts.values()]
        .filter(
          (draft) =>
            draft.ownerUserId === input.ownerUserId &&
            (input.statuses === undefined || input.statuses.includes(draft.status)),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async updateDraft(input) {
      const draft = drafts.get(input.draftId);

      if (!draft || draft.ownerUserId !== input.ownerUserId) {
        throw new Error("Message draft not found.");
      }

      const updated = messageDraftSchema.parse({
        ...draft,
        ...input.patch,
        updatedAt: new Date(),
      });
      drafts.set(updated.id, updated);

      return updated;
    },
  };
}

/**
 * Draft lifecycle store for tests and composition: the draft persistence store
 * plus a source-record base for person resolution, source-record grounding, and
 * audit logging. Mirrors the brief lifecycle store composition (PRD #65).
 */
export function createInMemoryDraftLifecycleStore(): InMemoryDraftLifecycleStore {
  return {
    ...createInMemorySourceRecordStore(),
    ...createInMemoryDraftStore(),
  };
}
