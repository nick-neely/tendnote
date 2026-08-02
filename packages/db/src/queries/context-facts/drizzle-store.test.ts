import { readFileSync } from "node:fs";
import { join } from "node:path";
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
      store.createAuditLogEntry({
        ownerUserId: "owner-1",
        action: auditRow.action,
        entityType: auditRow.entityType,
        entityId: auditRow.entityId,
        metadataJson: auditRow.metadataJson,
      }),
    ).resolves.toMatchObject({ ownerUserId: "owner-1", action: "context_fact.create" });
  });
});
