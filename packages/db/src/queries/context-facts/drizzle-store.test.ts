import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const { getDb } = vi.hoisted(() => ({
  getDb: vi.fn(() => {
    throw new Error("The Context Fact store issued a query it should have refused.");
  }),
}));
vi.mock("../../client", () => ({ getDb }));

const { createDrizzleContextFactStore, isPersistedContextFactId } = await import("./drizzle-store");
const source = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("Context Fact Drizzle store guards", () => {
  it("denies malformed ids and unscoped reads without querying Postgres", async () => {
    const store = createDrizzleContextFactStore();

    expect(isPersistedContextFactId("not-a-uuid")).toBe(false);
    expect(isPersistedContextFactId("00000000-0000-4000-8000-000000000001")).toBe(true);
    await expect(
      store.getContextFact({
        contextFactId: "not-a-uuid",
        subjectUserId: "owner-1",
      }),
    ).resolves.toBeNull();
    await expect(store.listContextFacts({})).resolves.toEqual([]);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("keeps persisted reads behind explicit Self or active-household subject filters", () => {
    expect(source).toContain('eq(contextFacts.subjectKind, "self")');
    expect(source).toContain('eq(contextFacts.subjectKind, "household")');
    expect(source).toContain("inArray(contextFacts.subjectHouseholdId, input.householdIds)");
    expect(source).toContain('from "household_memberships" as hm');
    expect(source).toContain("hm.status = 'active'");
    expect(source).toContain("getDb().transaction");
    expect(source).toContain('.for("update")');
    expect(source).toContain("eq(contextFacts.id, input.contextFactId)");
  });

  it("maps create, list, and audit results through the same persisted contract", async () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    const factRow = {
      id: "00000000-0000-4000-8000-000000000001",
      subjectKind: "self" as const,
      subjectUserId: "owner-1",
      subjectHouseholdId: null,
      category: "work" as const,
      content: "I run a software consultancy.",
      lifecycle: "active" as const,
      sensitivity: "normal" as const,
      provenanceJson: {
        channel: "account" as const,
        origin: "direct" as const,
        sourceRecordId: null,
      },
      suggestionEvidence: null,
      creatorUserId: "owner-1",
      lastActorUserId: "owner-1",
      reviewedAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const auditRow = {
      id: "00000000-0000-4000-8000-000000000002",
      ownerUserId: "owner-1",
      action: "context_fact.create",
      entityType: "context_fact",
      entityId: factRow.id,
      metadataJson: { category: "work" },
      createdAt: now,
    };
    let capturedUpdateWhere: unknown;
    const fakeDb = {
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          const query = {
            onConflictDoNothing: vi.fn(() => query),
            returning: vi.fn(async () => [values.ownerUserId ? auditRow : factRow]),
          };
          return query;
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [factRow]),
            orderBy: vi.fn(async () => [factRow]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn((where: unknown) => {
            capturedUpdateWhere = where;
            return {
              returning: vi.fn(async () => [
                {
                  ...factRow,
                  category: "preference" as const,
                  content: "I prefer concise answers.",
                  sensitivity: "sensitive" as const,
                },
              ]),
            };
          }),
        })),
      })),
    };
    getDb.mockImplementation(() => fakeDb as never);
    const store = createDrizzleContextFactStore();

    await expect(
      store.createContextFact({
        id: factRow.id,
        subject: { kind: "self", userId: "owner-1" },
        category: "work",
        content: factRow.content,
        lifecycle: "active",
        sensitivity: "normal",
        provenance: factRow.provenanceJson,
        suggestionEvidence: null,
        creatorUserId: "owner-1",
        lastActorUserId: "owner-1",
        reviewedAt: now,
        archivedAt: null,
      }),
    ).resolves.toMatchObject({ subject: { kind: "self", userId: "owner-1" }, category: "work" });
    await expect(
      store.listContextFacts({ subjectUserId: "owner-1", lifecycle: "active" }),
    ).resolves.toMatchObject([{ content: factRow.content, lifecycle: "active" }]);
    await expect(
      store.updateContextFact({
        contextFactId: factRow.id,
        subjectUserId: "owner-1",
        lifecycle: "active",
        patch: {
          category: "preference",
          content: "I prefer concise answers.",
          sensitivity: "sensitive",
          lastActorUserId: "owner-1",
          updatedAt: now,
        },
      }),
    ).resolves.toMatchObject({
      category: "preference",
      content: "I prefer concise answers.",
      sensitivity: "sensitive",
    });
    const renderedWhere = new PgDialect().sqlToQuery(capturedUpdateWhere as never);
    expect(renderedWhere.sql).toContain("subject_user_id");
    expect(renderedWhere.params).toEqual(expect.arrayContaining([factRow.id, "owner-1", "active"]));
    // Nothing reaches the driver as a `Date`: pg needs strings for these, and a
    // `Date` here is the failure that only shows up against real Postgres.
    expect(renderedWhere.params.some((param) => param instanceof Date)).toBe(false);
    await expect(
      store.createAuditLogEntry({
        ownerUserId: "owner-1",
        action: auditRow.action,
        entityType: auditRow.entityType,
        entityId: auditRow.entityId,
        metadataJson: auditRow.metadataJson,
      }),
    ).resolves.toMatchObject({ ownerUserId: "owner-1", action: "context_fact.create" });
  });

  it("compares an optimistic timestamp at the precision a caller can observe", () => {
    // `timestamptz` keeps microseconds and `now()` fills them in, but the driver
    // hands JavaScript a `Date`, which truncates to milliseconds. An exact
    // comparison therefore rejects every row Postgres timestamped itself, which is
    // every freshly created fact - accept, edit, archive and delete all fail with
    // "That suggestion changed elsewhere" on their first attempt.
    //
    // This lives on the generated SQL because the in-memory store compares two
    // `Date`s and cannot express the mismatch at all.
    expect(source).toContain("date_trunc('milliseconds'");
    expect(source).not.toContain("eq(contextFacts.updatedAt, input.expectedUpdatedAt)");
    expect(source).not.toContain("eq(contextFacts.archivedAt, input.expectedArchivedAt)");
    // A raw `sql` template does not route its values through the column
    // serializer, so the instant has to be bound as a cast string. Handing it a
    // `Date` renders identical SQL and then throws in the driver.
    expect(source).toContain("expected.toISOString()");
    expect(source).toContain("::timestamptz");
  });

  it("enforces the suggested-fact cap inside the persistence transaction", async () => {
    const now = new Date("2026-08-02T12:00:00.000Z");
    const factRow = {
      id: "00000000-0000-4000-8000-000000000003",
      subjectKind: "self" as const,
      subjectUserId: "owner-1",
      subjectHouseholdId: null,
      category: "work" as const,
      content: "I run a software consultancy.",
      lifecycle: "suggested" as const,
      sensitivity: "normal" as const,
      provenanceJson: {
        channel: "ambient" as const,
        origin: "ambient" as const,
        sourceRecordId: null,
      },
      suggestionEvidence: "A recent conversation mentioned the consultancy.",
      creatorUserId: "owner-1",
      lastActorUserId: "owner-1",
      reviewedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const pending = vi.fn(async () => [{ count: "0" }]);
    const transactionQuery = {
      from: vi.fn(() => ({ where: pending })),
    };
    const tx = {
      execute: vi.fn(async () => []),
      select: vi.fn(() => transactionQuery),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => [factRow]),
          })),
        })),
      })),
    };
    getDb.mockImplementation(
      () =>
        ({
          transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
        }) as never,
    );
    const store = createDrizzleContextFactStore();

    await expect(
      store.createContextFact({
        id: factRow.id,
        subject: { kind: "self", userId: "owner-1" },
        category: factRow.category,
        content: factRow.content,
        lifecycle: factRow.lifecycle,
        sensitivity: factRow.sensitivity,
        provenance: factRow.provenanceJson,
        suggestionEvidence: factRow.suggestionEvidence,
        creatorUserId: factRow.creatorUserId,
        lastActorUserId: factRow.lastActorUserId,
        reviewedAt: null,
        archivedAt: null,
        pendingSuggestionLimit: 2,
      }),
    ).resolves.toMatchObject({ id: factRow.id, lifecycle: "suggested" });
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(pending).toHaveBeenCalledOnce();
  });

  it("deletes a caller-scoped persisted fact through the guarded mutation path", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const deleteQuery = {
      where: vi.fn(() => ({
        returning: vi.fn(async () => [{ id }]),
      })),
    };
    getDb.mockImplementation(
      () =>
        ({
          delete: vi.fn(() => deleteQuery),
        }) as never,
    );
    const store = createDrizzleContextFactStore();

    await expect(
      store.deleteContextFact({
        contextFactId: id,
        subjectUserId: "owner-1",
        lifecycle: "active",
      }),
    ).resolves.toBe(true);
    expect(deleteQuery.where).toHaveBeenCalled();
  });
});
