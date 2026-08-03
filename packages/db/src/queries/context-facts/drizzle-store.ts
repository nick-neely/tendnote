import {
  type ContextFact,
  contextFactSchema,
  normalizeContextFactContent,
  type PersistContextFact,
  persistContextFactSchema,
} from "@tendnote/domain";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../client";
import { auditLog, contextFacts } from "../../schema";
import { isPersistedContextFactId } from "./id";
import type { ContextFactAuditLogEntry, ContextFactStore, ContextFactSubjectFilter } from "./types";

export { isPersistedContextFactId } from "./id";

function toRowValues(input: PersistContextFact) {
  const parsed = persistContextFactSchema.parse(input);
  if (parsed.id && !isPersistedContextFactId(parsed.id)) {
    throw new Error("Context Fact id must be a UUID.");
  }
  return {
    ...(parsed.id ? { id: parsed.id } : {}),
    subjectKind: parsed.subject.kind,
    subjectUserId: parsed.subject.kind === "self" ? parsed.subject.userId : null,
    subjectHouseholdId: parsed.subject.kind === "household" ? parsed.subject.householdId : null,
    category: parsed.category,
    content: parsed.content,
    normalizedContent: normalizeContextFactContent(parsed.content),
    lifecycle: parsed.lifecycle,
    sensitivity: parsed.sensitivity,
    provenanceJson: parsed.provenance,
    suggestionEvidence: parsed.suggestionEvidence,
    creatorUserId: parsed.creatorUserId,
    lastActorUserId: parsed.lastActorUserId,
    reviewedAt: parsed.reviewedAt,
    archivedAt: parsed.archivedAt,
  };
}

function fromRow(row: typeof contextFacts.$inferSelect): ContextFact {
  return contextFactSchema.parse({
    id: row.id,
    subject:
      row.subjectKind === "self"
        ? { kind: "self", userId: row.subjectUserId }
        : { kind: "household", householdId: row.subjectHouseholdId },
    category: row.category,
    content: row.content,
    lifecycle: row.lifecycle,
    sensitivity: row.sensitivity,
    provenance: row.provenanceJson,
    suggestionEvidence: row.suggestionEvidence,
    creatorUserId: row.creatorUserId,
    lastActorUserId: row.lastActorUserId,
    reviewedAt: row.reviewedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function subjectWhere(input: ContextFactSubjectFilter) {
  const predicates = [];
  if (input.subjectUserId) {
    predicates.push(
      and(
        eq(contextFacts.subjectKind, "self"),
        eq(contextFacts.subjectUserId, input.subjectUserId),
      ),
    );
  }
  if (input.householdIds?.length) {
    predicates.push(
      and(
        eq(contextFacts.subjectKind, "household"),
        inArray(contextFacts.subjectHouseholdId, input.householdIds),
      ),
    );
  }
  return predicates.length > 0 ? or(...predicates) : undefined;
}

export function createDrizzleContextFactStore(): ContextFactStore {
  return {
    async createContextFact(input) {
      const [row] = await getDb()
        .insert(contextFacts)
        .values(toRowValues(input))
        .onConflictDoNothing()
        .returning();
      if (!row) {
        throw new Error("Context Fact already exists.");
      }
      return fromRow(row);
    },
    // fallow-ignore-next-line complexity -- The persisted partial update maps one owner-scoped lifecycle patch to a single atomic SQL write.
    async updateContextFact(input) {
      if (!isPersistedContextFactId(input.contextFactId)) return null;
      const subject = subjectWhere(input);
      if (!subject) return null;
      const lifecycle = input.lifecycle ? eq(contextFacts.lifecycle, input.lifecycle) : undefined;
      const expectedUpdatedAt = input.expectedUpdatedAt
        ? eq(contextFacts.updatedAt, input.expectedUpdatedAt)
        : undefined;
      const expectedArchivedAt = input.expectedArchivedAt
        ? eq(contextFacts.archivedAt, input.expectedArchivedAt)
        : undefined;
      const where = and(
        eq(contextFacts.id, input.contextFactId),
        subject,
        lifecycle,
        expectedUpdatedAt,
        expectedArchivedAt,
      );
      const patch = {
        category: input.patch.category,
        content: input.patch.content,
        normalizedContent:
          input.patch.content === undefined
            ? undefined
            : normalizeContextFactContent(input.patch.content),
        sensitivity: input.patch.sensitivity,
        lifecycle: input.patch.lifecycle,
        archivedAt: input.patch.archivedAt,
        reviewedAt: input.patch.reviewedAt,
        suggestionEvidence: input.patch.suggestionEvidence,
        lastActorUserId: input.patch.lastActorUserId,
        updatedAt: input.patch.updatedAt,
      };
      const [row] = await getDb().update(contextFacts).set(patch).where(where).returning();
      return row ? fromRow(row) : null;
    },
    async deleteContextFact(input) {
      if (!isPersistedContextFactId(input.contextFactId)) return false;
      const subject = subjectWhere(input);
      if (!subject) return false;
      const auditLogEntry = input.auditLogEntry;
      if (auditLogEntry) {
        return getDb().transaction(async (tx) => {
          const [row] = await tx
            .delete(contextFacts)
            .where(and(eq(contextFacts.id, input.contextFactId), subject))
            .returning({ id: contextFacts.id });
          if (!row) return false;
          await tx.insert(auditLog).values(auditLogEntry);
          return true;
        });
      }
      const [row] = await getDb()
        .delete(contextFacts)
        .where(and(eq(contextFacts.id, input.contextFactId), subject))
        .returning({ id: contextFacts.id });
      return Boolean(row);
    },
    async getContextFact(input) {
      if (!isPersistedContextFactId(input.contextFactId)) return null;
      const subject = subjectWhere(input);
      if (!subject) return null;
      const [row] = await getDb()
        .select()
        .from(contextFacts)
        .where(and(eq(contextFacts.id, input.contextFactId), subject))
        .limit(1);
      return row ? fromRow(row) : null;
    },
    async listContextFacts(input) {
      const subject = subjectWhere(input);
      if (!subject) return [];
      const lifecycle = input.lifecycle
        ? eq(contextFacts.lifecycle, input.lifecycle)
        : input.lifecycles?.length
          ? inArray(contextFacts.lifecycle, input.lifecycles)
          : undefined;
      const where = lifecycle ? and(subject, lifecycle) : subject;
      const rows = await getDb()
        .select()
        .from(contextFacts)
        .where(where)
        .orderBy(desc(contextFacts.updatedAt), asc(contextFacts.id));
      return rows.map(fromRow);
    },
    async createAuditLogEntry(input) {
      const [row] = await getDb().insert(auditLog).values(input).returning();
      if (!row?.ownerUserId) {
        throw new Error("Failed to create Context Fact audit log entry.");
      }
      return {
        ...row,
        ownerUserId: row.ownerUserId,
      } satisfies ContextFactAuditLogEntry;
    },
    async listAuditLogEntries(input) {
      const rows = await getDb()
        .select()
        .from(auditLog)
        .where(eq(auditLog.ownerUserId, input.ownerUserId))
        .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
      return rows.filter(
        (row): row is typeof row & { ownerUserId: string } => row.ownerUserId !== null,
      );
    },
  };
}
