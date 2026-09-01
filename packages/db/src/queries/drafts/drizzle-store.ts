import { createMessageDraftSchema, type MessageDraft, messageDraftSchema } from "@tendnote/domain";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { messageDrafts } from "../../schema";
import { createDrizzleSourceRecordStore } from "../source-records/drizzle-store";
import type { DraftLifecycleStore, DraftStore, UpdateDraftInput } from "./types";

type MessageDraftRow = typeof messageDrafts.$inferSelect;

function rowToDraft(row: MessageDraftRow): MessageDraft {
  // Parsing keeps Date coercion and source-ref typing consistent with reads and
  // validates persisted source refs against the domain schema.
  return messageDraftSchema.parse({
    id: row.id,
    personId: row.personId,
    ownerUserId: row.ownerUserId,
    channel: row.channel,
    purpose: row.purpose,
    body: row.body,
    status: row.status,
    sourceRefs: row.sourceRefs ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Drizzle-backed draft persistence store. Carries only draft methods so it can be
 * spread into the composed lifecycle store without shadowing person/source/audit
 * methods (mirrors the brief store, PRD #65). Source references are stored on the
 * draft row, so they are owner-scoped by construction.
 */
export function createDrizzleDraftStore(): DraftStore {
  // Overloaded so an `expectedBody`-guarded call is typed as possibly-null (guard
  // failed = body changed) while every unguarded caller keeps a non-null draft.
  async function updateDraft(
    input: UpdateDraftInput & { expectedBody: string },
  ): Promise<MessageDraft | null>;
  async function updateDraft(input: UpdateDraftInput): Promise<MessageDraft>;
  async function updateDraft(input: UpdateDraftInput): Promise<MessageDraft | null> {
    const [draft] = await getDb()
      .update(messageDrafts)
      .set({
        ...input.patch,
        // Atomic stale-approval revocation (edit side): decided from the row's
        // CURRENT status in the same UPDATE, so no concurrent approval can survive a
        // body edit (security). Only `approved -> draft`; every other status is
        // preserved.
        ...(input.revertApprovalToDraft
          ? {
              status: sql`CASE WHEN ${messageDrafts.status} = 'approved' THEN 'draft' ELSE ${messageDrafts.status} END`,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(messageDrafts.id, input.draftId),
          eq(messageDrafts.ownerUserId, input.ownerUserId),
          // Optimistic-concurrency guard (approve side): constrain the UPDATE to a
          // row whose body still equals what the caller read, IN the same statement.
          // If a concurrent edit changed the body, no row matches and we return null
          // below, so an approval can never land on unreviewed text (security).
          ...(input.expectedBody !== undefined ? [eq(messageDrafts.body, input.expectedBody)] : []),
        ),
      )
      .returning();

    if (!draft) {
      // With the guard, a missing row means the body moved since it was read (a
      // real, owner-owned draft the caller must be told to re-review), NOT an absent
      // record — return null so the caller distinguishes it from the not-found
      // sentinel. Without the guard, behaviour is unchanged.
      if (input.expectedBody !== undefined) {
        return null;
      }
      throw new Error("Message draft not found.");
    }

    return rowToDraft(draft);
  }

  return {
    async createDraft(input) {
      const parsed = createMessageDraftSchema.parse(input);
      const [draft] = await getDb()
        .insert(messageDrafts)
        .values({
          personId: parsed.personId,
          ownerUserId: parsed.ownerUserId,
          channel: parsed.channel,
          purpose: parsed.purpose,
          body: parsed.body,
          status: parsed.status,
          sourceRefs: parsed.sourceRefs,
        })
        .returning();

      if (!draft) {
        throw new Error("Failed to create message draft.");
      }

      return rowToDraft(draft);
    },
    async getDraft(input) {
      const [draft] = await getDb()
        .select()
        .from(messageDrafts)
        .where(
          and(
            eq(messageDrafts.id, input.draftId),
            eq(messageDrafts.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);

      return draft ? rowToDraft(draft) : null;
    },
    async listDraftsForPerson(input) {
      const rows = await getDb()
        .select()
        .from(messageDrafts)
        .where(
          and(
            eq(messageDrafts.ownerUserId, input.ownerUserId),
            eq(messageDrafts.personId, input.personId),
            ...(input.statuses ? [inArray(messageDrafts.status, input.statuses)] : []),
          ),
        )
        .orderBy(desc(messageDrafts.createdAt));

      return rows.map(rowToDraft);
    },
    async listDraftsForOwner(input) {
      const rows = await getDb()
        .select()
        .from(messageDrafts)
        .where(
          and(
            eq(messageDrafts.ownerUserId, input.ownerUserId),
            ...(input.statuses ? [inArray(messageDrafts.status, input.statuses)] : []),
          ),
        )
        .orderBy(desc(messageDrafts.createdAt));

      return rows.map(rowToDraft);
    },
    updateDraft,
  };
}

/**
 * Draft lifecycle store: the draft persistence store plus the source-record store
 * for person resolution, source-record grounding, and audit logging. Mirrors the
 * brief lifecycle store composition (PRD #65).
 */
export function createDrizzleDraftLifecycleStore(): DraftLifecycleStore {
  return {
    ...createDrizzleSourceRecordStore(),
    ...createDrizzleDraftStore(),
  };
}
