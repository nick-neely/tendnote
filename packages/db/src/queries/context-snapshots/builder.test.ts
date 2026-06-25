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

    expect(result.snapshot).toBeNull();
    expect(await snapshotStore.listContextSnapshots({ ownerUserId: OWNER })).toEqual([]);
  });
});
