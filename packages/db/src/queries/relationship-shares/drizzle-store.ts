import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { followups, memories, people, sourceRecords, user } from "../../schema";
import { createDrizzleHouseholdStore } from "../households/drizzle-store";
import type { RelationshipRecordFacts, RelationshipShareStore } from "./types";

/**
 * A memory is the owner's settled recollection only once they have approved it;
 * a dismissed one is a rejected guess and reads as gone. Archived stays active:
 * archiving is a lifecycle decision the owner made about their own record, not
 * a revocation of an audience they chose.
 */
function memoryFacts(row: typeof memories.$inferSelect): RelationshipRecordFacts {
  return {
    recordKind: "memory",
    recordId: row.id,
    ownerUserId: row.ownerUserId,
    personId: row.personId,
    scope: row.scope,
    householdId: row.householdId,
    sensitivity: row.sensitivity,
    lifecycle: row.status === "dismissed" ? "ended" : "active",
    shareable: row.status === "approved" || row.status === "archived",
    body: row.content,
    recordedAt: row.approvedAt ?? row.createdAt,
    trust: row.confidence,
    dueAt: null,
  };
}

/**
 * A source record carries no person, by design: it is evidence, and revealing
 * who it resolved to would disclose a Person link the owner never shared
 * (ADR 0218). A record still awaiting mention resolution is not settled enough
 * to share.
 */
function sourceRecordFacts(row: typeof sourceRecords.$inferSelect): RelationshipRecordFacts {
  return {
    recordKind: "source_record",
    recordId: row.id,
    ownerUserId: row.ownerUserId,
    personId: null,
    scope: row.scope,
    householdId: row.householdId,
    sensitivity: row.sensitivity,
    lifecycle: row.status === "dismissed" ? "ended" : "active",
    shareable: row.status === "active" || row.status === "archived",
    body: row.content,
    recordedAt: row.createdAt,
    trust: row.confidence,
    dueAt: null,
  };
}

/**
 * Follow-ups carry no sensitivity column, so they take the conservative default
 * rather than a derived one — a family with no such concept gets `normal` and
 * never accidentally claims restricted handling it does not implement. A
 * suggested follow-up is the assistant's proposal and is not the owner's to
 * share until they accept it.
 */
function followupFacts(row: typeof followups.$inferSelect): RelationshipRecordFacts {
  return {
    recordKind: "followup",
    recordId: row.id,
    ownerUserId: row.ownerUserId,
    personId: row.personId,
    scope: row.scope,
    householdId: row.householdId,
    sensitivity: "normal",
    lifecycle: row.status === "dismissed" ? "ended" : "active",
    shareable: row.status !== "suggested",
    body: row.reason,
    recordedAt: row.createdAt,
    trust: null,
    dueAt: row.dueAt,
  };
}

export function createDrizzleRelationshipShareStore(): RelationshipShareStore {
  return {
    ...createDrizzleHouseholdStore(),

    async getRelationshipRecord(input) {
      // No owner filter anywhere below: an audience member is by definition not
      // the owner, so this read must be able to find the row. The proof above
      // it decides whether the caller may be shown it (ADR 0219).
      if (input.recordKind === "memory") {
        const [row] = await getDb()
          .select()
          .from(memories)
          .where(eq(memories.id, input.recordId))
          .limit(1);
        return row ? memoryFacts(row) : null;
      }

      if (input.recordKind === "source_record") {
        const [row] = await getDb()
          .select()
          .from(sourceRecords)
          .where(eq(sourceRecords.id, input.recordId))
          .limit(1);
        return row ? sourceRecordFacts(row) : null;
      }

      const [row] = await getDb()
        .select()
        .from(followups)
        .where(eq(followups.id, input.recordId))
        .limit(1);
      return row ? followupFacts(row) : null;
    },

    async updateRelationshipRecordVisibility(input) {
      const patch = { scope: input.scope, householdId: input.householdId, updatedAt: new Date() };

      if (input.recordKind === "memory") {
        await getDb()
          .update(memories)
          .set(patch)
          .where(and(eq(memories.id, input.recordId), eq(memories.ownerUserId, input.ownerUserId)));
        return;
      }

      if (input.recordKind === "source_record") {
        await getDb()
          .update(sourceRecords)
          .set(patch)
          .where(
            and(
              eq(sourceRecords.id, input.recordId),
              eq(sourceRecords.ownerUserId, input.ownerUserId),
            ),
          );
        return;
      }

      await getDb()
        .update(followups)
        .set(patch)
        .where(and(eq(followups.id, input.recordId), eq(followups.ownerUserId, input.ownerUserId)));
    },

    async getPersonDisplayLabel(input) {
      // Owner-keyed: the label that crosses a share is the record owner's, never
      // the reader's own Person for the same human (ADR 0218). Only
      // `displayName` is selected — the profile stays where it is.
      const [row] = await getDb()
        .select({ displayName: people.displayName })
        .from(people)
        .where(and(eq(people.id, input.personId), eq(people.ownerUserId, input.ownerUserId)))
        .limit(1);
      return row?.displayName ?? null;
    },

    async getMemberDisplayName(input) {
      const [row] = await getDb()
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, input.userId))
        .limit(1);
      return row?.name ?? null;
    },
  };
}
