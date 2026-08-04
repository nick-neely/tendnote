import {
  type ContextFact,
  contextFactSchema,
  normalizeContextFactContent,
  type PersistContextFact,
  persistContextFactSchema,
} from "@tendnote/domain";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "../../client";
import { auditLog, contextFacts, householdMemberships } from "../../schema";
import { isPersistedContextFactId } from "./id";
import type { ContextFactAuditLogEntry, ContextFactStore, ContextFactSubjectFilter } from "./types";

export { isPersistedContextFactId } from "./id";

type ContextFactTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type HouseholdSubject = Extract<ContextFact["subject"], { kind: "household" }>;

async function lockActiveHouseholdMembership(
  tx: ContextFactTransaction,
  subject: HouseholdSubject,
  memberUserId: string,
) {
  const [membership] = await tx
    .select({ id: householdMemberships.id })
    .from(householdMemberships)
    .where(
      and(
        eq(householdMemberships.householdId, subject.householdId),
        eq(householdMemberships.userId, memberUserId),
        eq(householdMemberships.status, "active"),
      ),
    )
    .limit(1)
    .for("update");
  return Boolean(membership);
}

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
    if (input.activeHouseholdMemberUserId === undefined) return undefined;
    const activeMembership = sql`exists (
      select 1
      from "household_memberships" as hm
      where hm.household_id = ${contextFacts.subjectHouseholdId}
        and hm.user_id = ${input.activeHouseholdMemberUserId}
        and hm.status = 'active'
    )`;
    predicates.push(
      and(
        eq(contextFacts.subjectKind, "household"),
        inArray(contextFacts.subjectHouseholdId, input.householdIds),
        activeMembership,
      ),
    );
  }
  return predicates.length > 0 ? or(...predicates) : undefined;
}

type ContextFactInsertResult =
  | { kind: "created"; row: typeof contextFacts.$inferSelect }
  | "duplicate"
  | "limit"
  | "membership-missing";

function subjectPredicate(subject: ContextFact["subject"]) {
  return subject.kind === "self"
    ? and(eq(contextFacts.subjectKind, "self"), eq(contextFacts.subjectUserId, subject.userId))
    : and(
        eq(contextFacts.subjectKind, "household"),
        eq(contextFacts.subjectHouseholdId, subject.householdId),
      );
}

async function insertContextFactRow(
  executor: Pick<ContextFactTransaction, "insert">,
  values: ReturnType<typeof toRowValues>,
): Promise<Exclude<ContextFactInsertResult, "limit" | "membership-missing">> {
  const [created] = await executor
    .insert(contextFacts)
    .values(values)
    .onConflictDoNothing()
    .returning();
  return created ? { kind: "created", row: created } : "duplicate";
}

async function insertSuggestedContextFactWithLimit(input: {
  subject: ContextFact["subject"];
  values: ReturnType<typeof toRowValues>;
  activeHouseholdMemberUserId?: string;
  pendingSuggestionLimit: number;
}): Promise<ContextFactInsertResult> {
  return getDb().transaction(async (tx) => {
    const lockKey = `${input.subject.kind}:${
      input.subject.kind === "self" ? input.subject.userId : input.subject.householdId
    }`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    if (
      input.subject.kind === "household" &&
      !(await lockActiveHouseholdMembership(
        tx,
        input.subject,
        input.activeHouseholdMemberUserId ?? "",
      ))
    )
      return "membership-missing";

    const [pending] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(contextFacts)
      .where(and(subjectPredicate(input.subject), eq(contextFacts.lifecycle, "suggested")));
    if (Number(pending?.count ?? 0) >= input.pendingSuggestionLimit) return "limit";
    return insertContextFactRow(tx, input.values);
  });
}

async function insertHouseholdContextFact(input: {
  subject: Extract<ContextFact["subject"], { kind: "household" }>;
  values: ReturnType<typeof toRowValues>;
  activeHouseholdMemberUserId?: string;
}) {
  return getDb().transaction(async (tx) => {
    if (
      !(await lockActiveHouseholdMembership(
        tx,
        input.subject,
        input.activeHouseholdMemberUserId ?? "",
      ))
    )
      return "membership-missing" as const;
    return insertContextFactRow(tx, input.values);
  });
}

function contextFactFromInsertResult(result: ContextFactInsertResult): ContextFact {
  if (result === "limit") throw new Error("Pending Context Fact suggestion limit reached.");
  if (result === "membership-missing") {
    throw new Error("Active household membership is required for Household Context.");
  }
  if (result === "duplicate") throw new Error("Context Fact already exists.");
  return fromRow(result.row);
}

/**
 * Match an optimistic-concurrency timestamp at the resolution the caller can see.
 *
 * `timestamptz` keeps microseconds and `now()` fills them in, but the driver hands
 * JavaScript a `Date`, which cannot hold them. So a client that reads `updated_at`
 * and sends it back is necessarily sending a millisecond truncation of the stored
 * value, and an exact comparison rejects every row Postgres timestamped itself -
 * which is every freshly created fact. The token is the instant as the caller
 * observed it, so that is the precision the comparison uses.
 *
 * The in-memory store cannot reproduce this: both sides are `Date` there, so the
 * mismatch only exists against real Postgres.
 */
function matchesObservedInstant(column: AnyPgColumn, expected: Date) {
  // Bound as an ISO string with an explicit cast: a raw `sql` template does not
  // route the value through the column's serializer, so handing it a `Date`
  // reaches the driver as a `Date` and the query throws.
  return sql`date_trunc('milliseconds', ${column}) = ${expected.toISOString()}::timestamptz`;
}

export function createDrizzleContextFactStore(): ContextFactStore {
  return {
    async createContextFact(input) {
      const { activeHouseholdMemberUserId, pendingSuggestionLimit, ...persistedInput } = input;
      const values = toRowValues(persistedInput);
      const subject = persistedInput.subject;
      if (persistedInput.lifecycle === "suggested" && pendingSuggestionLimit !== undefined) {
        return contextFactFromInsertResult(
          await insertSuggestedContextFactWithLimit({
            subject,
            values,
            activeHouseholdMemberUserId,
            pendingSuggestionLimit,
          }),
        );
      }
      if (subject.kind === "household") {
        return contextFactFromInsertResult(
          await insertHouseholdContextFact({
            subject,
            values,
            activeHouseholdMemberUserId,
          }),
        );
      }

      const [row] = await getDb()
        .insert(contextFacts)
        .values(values)
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
        ? matchesObservedInstant(contextFacts.updatedAt, input.expectedUpdatedAt)
        : undefined;
      const expectedArchivedAt = input.expectedArchivedAt
        ? matchesObservedInstant(contextFacts.archivedAt, input.expectedArchivedAt)
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
      const lifecycle = input.lifecycle ? eq(contextFacts.lifecycle, input.lifecycle) : undefined;
      const expectedUpdatedAt = input.expectedUpdatedAt
        ? matchesObservedInstant(contextFacts.updatedAt, input.expectedUpdatedAt)
        : undefined;
      const where = and(
        eq(contextFacts.id, input.contextFactId),
        subject,
        lifecycle,
        expectedUpdatedAt,
      );
      const auditLogEntry = input.auditLogEntry;
      if (auditLogEntry) {
        return getDb().transaction(async (tx) => {
          const [row] = await tx
            .delete(contextFacts)
            .where(where)
            .returning({ id: contextFacts.id });
          if (!row) return false;
          await tx.insert(auditLog).values(auditLogEntry);
          return true;
        });
      }
      const [row] = await getDb()
        .delete(contextFacts)
        .where(where)
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
