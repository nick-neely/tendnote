import { DETERMINISTIC_GENERATOR_VERSION, type MemoryStatus } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryMemoryStore } from "../memories/in-memory-store";
import { createPersonContextSnapshot } from "./builder";
import { createInMemoryContextSnapshotStore } from "./in-memory-store";
import type { PersonContextSnapshotStore } from "./types";

const OWNER = "user-1";

async function setup() {
  const memoryStore = createInMemoryMemoryStore();
  const snapshotStore = createInMemoryContextSnapshotStore();
  const store: PersonContextSnapshotStore & typeof memoryStore & typeof snapshotStore = {
    ...memoryStore,
    ...snapshotStore,
  };
  const reader = createPersonContextSnapshot(store);

  const person = await memoryStore.createPerson({
    ownerUserId: OWNER,
    displayName: "Mark",
    firstName: null,
    lastName: null,
    birthday: "1990-04-12",
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });

  async function seedMemory(content: string, status: MemoryStatus) {
    const sourceRecord = await memoryStore.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: `source for: ${content}`,
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await memoryStore.linkSourceRecordPerson({
      sourceRecordId: sourceRecord.id,
      personId: person.id,
      role: "primary",
    });

    return memoryStore.createMemory({
      personId: person.id,
      ownerUserId: OWNER,
      sourceRecordId: sourceRecord.id,
      memoryType: "context",
      content,
      status,
      importance: 3,
      sensitivity: "normal",
      confidence: "medium",
      scope: "private",
      approvedAt: status === "approved" ? new Date() : null,
    });
  }

  return { store, memoryStore, snapshotStore, reader, person, seedMemory };
}

describe("snapshot-backed person context read path", () => {
  it("creates one current snapshot row for a person without an existing snapshot", async () => {
    const { reader, snapshotStore, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");

    const result = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot?.summary).toContain("vegetarian");
    expect(result.snapshot?.generatorVersion).toBe(DETERMINISTIC_GENERATOR_VERSION);
    expect(result.snapshot?.inputFingerprint.length).toBeGreaterThan(0);
    expect(result.snapshot?.generatedAt).toBeInstanceOf(Date);

    const rows = await snapshotStore.listContextSnapshots({ ownerUserId: OWNER });
    expect(rows).toHaveLength(1);
  });

  it("persists record-level supporting references", async () => {
    const { reader, person, seedMemory } = await setup();
    const approved = await seedMemory("Mark is vegetarian.", "approved");
    const suggested = await seedMemory("Mark might be moving.", "suggested");

    const result = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    const refs = result.snapshot?.supportingReferences;
    expect(refs?.personIds).toEqual([person.id]);
    expect(refs?.memoryIds).toEqual([approved.id]);
    expect(refs?.suggestedMemoryIds).toEqual([suggested.id]);
    expect(refs?.sourceRecordIds.length).toBeGreaterThan(0);
  });

  it("reuses the existing current row rather than creating a second", async () => {
    const { reader, snapshotStore, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");

    const first = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });
    const second = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(second.snapshot?.id).toBe(first.snapshot?.id);
    const rows = await snapshotStore.listContextSnapshots({ ownerUserId: OWNER });
    expect(rows).toHaveLength(1);
  });

  it("does not create audit-log entries for snapshot rebuilds", async () => {
    const { reader, memoryStore, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");

    await reader.getPersonContextSnapshot({ ownerUserId: OWNER, personId: person.id });

    const auditEntries = await memoryStore.listAuditLogEntries({ ownerUserId: OWNER });
    expect(auditEntries).toEqual([]);
  });

  it("is owner-scoped: another owner cannot read or build over a person they do not own", async () => {
    const { reader, snapshotStore, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");
    await reader.getPersonContextSnapshot({ ownerUserId: OWNER, personId: person.id });

    const intruder = await reader.getPersonContextSnapshot({
      ownerUserId: "intruder",
      personId: person.id,
    });

    expect(intruder.snapshot).toBeNull();
    expect(await snapshotStore.listContextSnapshots({ ownerUserId: "intruder" })).toEqual([]);
  });

  it("returns no snapshot for an unknown person", async () => {
    const { reader, snapshotStore } = await setup();

    const result = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: "missing-person",
    });

    expect(result.status).toBe("fallback");
    expect(result.snapshot).toBeNull();
    expect(await snapshotStore.listContextSnapshots({ ownerUserId: OWNER })).toEqual([]);
  });
});

describe("snapshot freshness and fail-open rebuild", () => {
  it("reuses a fresh snapshot without regenerating", async () => {
    const { reader, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");

    const first = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });
    const second = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(first.status).toBe("rebuilt");
    expect(second.status).toBe("fresh");
    expect(second.snapshot?.id).toBe(first.snapshot?.id);
  });

  it("rebuilds a stale snapshot when a visible record changes", async () => {
    const { reader, snapshotStore, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");
    const first = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    await seedMemory("Mark just adopted a dog.", "approved");
    const second = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(second.status).toBe("rebuilt");
    expect(second.snapshot?.id).toBe(first.snapshot?.id);
    expect(second.snapshot?.summary).toContain("adopted a dog");
    expect(await snapshotStore.listContextSnapshots({ ownerUserId: OWNER })).toHaveLength(1);
  });

  it("rebuilds when a suggested memory is approved (lifecycle change)", async () => {
    const { reader, memoryStore, person, seedMemory } = await setup();
    const suggested = await seedMemory("Mark might be moving.", "suggested");
    const first = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });
    // While suggested, it is never stated as a confirmed fact.
    expect(first.snapshot?.summary).not.toContain("Confirmed:");

    await memoryStore.updateMemory({
      ownerUserId: OWNER,
      memoryId: suggested.id,
      patch: { status: "approved", approvedAt: new Date() },
    });
    const second = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(second.status).toBe("rebuilt");
    expect(second.snapshot?.summary).toContain("Confirmed: Mark might be moving.");
  });

  it("fails open to Phase 1A context when generation fails and no prior snapshot exists", async () => {
    const { store, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");
    const failing = createPersonContextSnapshot(store, {
      generator: () => {
        throw new Error("generator boom");
      },
    });

    const result = await failing.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(result.status).toBe("fallback");
    expect(result.snapshot).toBeNull();
    expect(result.context.person?.id).toBe(person.id);
    expect(result.context.approvedMemories.map((memory) => memory.content)).toContain(
      "Mark is vegetarian.",
    );
  });

  it("records failure metadata while preserving the prior snapshot on a failed rebuild", async () => {
    const { store, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");
    const good = createPersonContextSnapshot(store);
    const first = await good.getPersonContextSnapshot({ ownerUserId: OWNER, personId: person.id });

    // Change inputs so the next read must rebuild, then make generation fail.
    await seedMemory("Mark started a new job.", "approved");
    const failing = createPersonContextSnapshot(store, {
      generator: () => {
        throw new Error("generator boom");
      },
    });
    const result = await failing.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(result.status).toBe("fallback");
    expect(result.snapshot?.failureReason).toBe("generator boom");
    // Prior prose is preserved rather than wiped on failure.
    expect(result.snapshot?.summary).toBe(first.snapshot?.summary);
    // The fingerprint stays stale so the next successful read retries the rebuild.
    const retry = await good.getPersonContextSnapshot({ ownerUserId: OWNER, personId: person.id });
    expect(retry.status).toBe("rebuilt");
    expect(retry.snapshot?.failureReason).toBeNull();
    expect(retry.snapshot?.summary).toContain("started a new job");
  });

  it("derives supporting references from records even with a prose-only generator", async () => {
    const { store, person, seedMemory } = await setup();
    const approved = await seedMemory("Mark is vegetarian.", "approved");
    const reader = createPersonContextSnapshot(store, {
      generator: () => ({
        summary: "totally custom prose with no record ids",
        generatorVersion: "llm:test-model",
      }),
    });

    const result = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(result.snapshot?.summary).toBe("totally custom prose with no record ids");
    expect(result.snapshot?.generatorVersion).toBe("llm:test-model");
    expect(result.snapshot?.supportingReferences.memoryIds).toEqual([approved.id]);
    expect(result.snapshot?.supportingReferences.personIds).toEqual([person.id]);
  });

  it("keeps freshness owner-scoped", async () => {
    const { reader, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");
    await reader.getPersonContextSnapshot({ ownerUserId: OWNER, personId: person.id });

    const intruder = await reader.getPersonContextSnapshot({
      ownerUserId: "intruder",
      personId: person.id,
    });

    expect(intruder.status).toBe("fallback");
    expect(intruder.snapshot).toBeNull();
    expect(intruder.context.person).toBeNull();
  });
});
