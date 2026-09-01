import { randomUUID } from "node:crypto";
import { createMessageDraftSchema, type MessageDraft, messageDraftSchema } from "@tendnote/domain";
import { createInMemorySourceRecordStore } from "../source-records/in-memory-store";
import type { DraftStore, InMemoryDraftLifecycleStore, UpdateDraftInput } from "./types";

/**
 * Minimal draft persistence over one map. Source references travel with the draft
 * so owner scoping and grounding are exercised in tests without a database. It
 * carries only draft methods so it can be spread into the composed lifecycle
 * store without shadowing person/source/audit methods (mirrors the brief store).
 */
export function createInMemoryDraftStore(): DraftStore {
  const drafts = new Map<string, MessageDraft>();

  // Overloaded to mirror the drizzle store: an `expectedBody`-guarded call may
  // return null (guard failed = body changed), unguarded callers keep a non-null
  // draft.
  async function updateDraft(
    input: UpdateDraftInput & { expectedBody: string },
  ): Promise<MessageDraft | null>;
  async function updateDraft(input: UpdateDraftInput): Promise<MessageDraft>;
  async function updateDraft(input: UpdateDraftInput): Promise<MessageDraft | null> {
    const draft = drafts.get(input.draftId);

    if (!draft || draft.ownerUserId !== input.ownerUserId) {
      // Mirror the guarded drizzle WHERE: a guarded call that matches no row returns
      // null (the caller re-reviews) rather than the not-found sentinel.
      if (input.expectedBody !== undefined) {
        return null;
      }
      throw new Error("Message draft not found.");
    }

    // Optimistic-concurrency guard (approve side): only apply the patch if the
    // stored body still equals what the caller read. Mirrors the drizzle
    // `eq(body, expectedBody)` WHERE atomically — the same single operation checks
    // and writes, so a concurrent edit that changed the body refuses the approve.
    if (input.expectedBody !== undefined && draft.body !== input.expectedBody) {
      return null;
    }

    // Mirror the drizzle CASE atomically: within this single update operation,
    // force `status = draft` iff the row is CURRENTLY `approved`. Decided from the
    // stored status, never a caller-supplied read, so the store — not the lifecycle
    // layer — owns the stale-approval revocation (security).
    const revertsApproval = input.revertApprovalToDraft === true && draft.status === "approved";
    const updated = messageDraftSchema.parse({
      ...draft,
      ...input.patch,
      ...(revertsApproval ? { status: "draft" } : {}),
      updatedAt: new Date(),
    });
    drafts.set(updated.id, updated);

    return updated;
  }

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
    updateDraft,
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
