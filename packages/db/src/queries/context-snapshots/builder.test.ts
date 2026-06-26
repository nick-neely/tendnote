import { DETERMINISTIC_GENERATOR_VERSION, type MemoryStatus } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryFollowupStore } from "../followups/in-memory-store";
import { createInMemoryMemoryStore } from "../memories/in-memory-store";
import { createPersonContextSnapshot, type PersonContextSnapshotResult } from "./builder";
import { createInMemoryContextSnapshotStore } from "./in-memory-store";
import type { PersonContextSnapshotStore } from "./types";

const OWNER = "user-1";

/** A snapshot read that fell open to the seeded relational context. */
function expectRelationalFallback(result: PersonContextSnapshotResult, personId: string) {
  expect(result.status).toBe("fallback");
  expect(result.snapshot).toBeNull();
  expect(result.context.person?.id).toBe(personId);
  expect(result.context.approvedMemories.map((memory) => memory.content)).toContain(
    "Mark is vegetarian.",
  );
}

async function setup() {
  const memoryStore = createInMemoryMemoryStore();
  const followupStore = createInMemoryFollowupStore();
  const snapshotStore = createInMemoryContextSnapshotStore();
  const store: PersonContextSnapshotStore &
    typeof memoryStore &
    typeof followupStore &
    typeof snapshotStore = {
    ...memoryStore,
    ...followupStore,
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

  return { store, memoryStore, followupStore, snapshotStore, reader, person, seedMemory };
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

    expectRelationalFallback(result, person.id);
  });

  it("fails open to Phase 1A context when the snapshot store read throws (unmigrated table)", async () => {
    const { store, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");

    // Simulate a snapshots table/column that does not exist yet (dev DB behind
    // on migrations): the cache read throws before any generation happens.
    const broken = createPersonContextSnapshot({
      ...store,
      getContextSnapshot: async () => {
        throw new Error('relation "person_context_snapshots" does not exist');
      },
    });

    const result = await broken.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    // The tool still answers from relational context instead of throwing.
    expectRelationalFallback(result, person.id);
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

describe("compact follow-up context in snapshots", () => {
  it("includes active follow-ups as compact references", async () => {
    const { reader, followupStore, person } = await setup();
    const followup = await followupStore.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Check in about the move.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
      status: "open",
    });

    const { snapshot } = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(snapshot?.followups).toEqual([
      {
        id: followup.id,
        status: "open",
        dueAt: "2026-07-01T00:00:00.000Z",
        reason: "Check in about the move.",
      },
    ]);
    expect(snapshot?.supportingReferences.followupIds).toEqual([followup.id]);
  });

  it("includes recently completed follow-ups but not suggested or dismissed ones", async () => {
    const { reader, followupStore, person } = await setup();
    const recentlyDone = await followupStore.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Sent birthday note.",
      dueAt: new Date("2026-06-01T00:00:00Z"),
      status: "completed",
    });
    await followupStore.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Maybe grab coffee.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
      status: "suggested",
    });
    await followupStore.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Old idea.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
      status: "dismissed",
    });

    const { snapshot } = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(snapshot?.followups.map((followup) => followup.id)).toEqual([recentlyDone.id]);
  });

  it("treats a new relevant follow-up as a freshness change", async () => {
    const { reader, followupStore, person, seedMemory } = await setup();
    await seedMemory("Mark is vegetarian.", "approved");

    const first = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });
    const fresh = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });
    expect(first.status).toBe("rebuilt");
    expect(fresh.status).toBe("fresh");

    await followupStore.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Follow up on the interview.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
      status: "open",
    });
    const afterFollowup = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(afterFollowup.status).toBe("rebuilt");
    expect(afterFollowup.snapshot?.followups).toHaveLength(1);
  });

  it("reflects follow-ups without taking ownership of their lifecycle", async () => {
    const { reader, followupStore, person } = await setup();
    const followup = await followupStore.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Reconnect.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
      status: "open",
    });

    await reader.getPersonContextSnapshot({ ownerUserId: OWNER, personId: person.id });

    // The follow-up record is the canonical source — the snapshot only mirrors it.
    const stored = await followupStore.listFollowupsForPerson({
      ownerUserId: OWNER,
      personId: person.id,
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(followup.id);
    expect(stored[0]?.status).toBe("open");
  });

  it("does not leak follow-ups to another owner", async () => {
    const { reader, followupStore, person } = await setup();
    await followupStore.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Private reminder.",
      dueAt: new Date("2026-07-01T00:00:00Z"),
      status: "open",
    });

    const intruder = await reader.getPersonContextSnapshot({
      ownerUserId: "intruder",
      personId: person.id,
    });

    expect(intruder.snapshot).toBeNull();
  });
});

describe("corrections route through underlying records, not snapshot text", () => {
  it("rebuilds the snapshot when an underlying memory is corrected", async () => {
    const { reader, memoryStore, person, seedMemory } = await setup();
    const memory = await seedMemory("Mark is vegetarian.", "approved");
    const first = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });
    expect(first.snapshot?.summary).toContain("Mark is vegetarian.");

    // Correcting the record — not the snapshot text — is the only way to change
    // what the snapshot says. The same row is rebuilt from the corrected record.
    await memoryStore.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: { content: "Mark is vegan." },
    });
    const second = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(second.status).toBe("rebuilt");
    expect(second.snapshot?.id).toBe(first.snapshot?.id);
    expect(second.snapshot?.summary).toContain("Confirmed: Mark is vegan.");
    expect(second.snapshot?.summary).not.toContain("Confirmed: Mark is vegetarian.");
  });

  it("drops a dismissed memory from the summary and its supporting references", async () => {
    const { reader, memoryStore, person, seedMemory } = await setup();
    const keep = await seedMemory("Mark loves hiking.", "approved");
    const remove = await seedMemory("Mark is vegetarian.", "approved");
    await reader.getPersonContextSnapshot({ ownerUserId: OWNER, personId: person.id });

    await memoryStore.updateMemory({
      ownerUserId: OWNER,
      memoryId: remove.id,
      patch: { status: "dismissed", dismissedAt: new Date() },
    });
    const corrected = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(corrected.status).toBe("rebuilt");
    expect(corrected.snapshot?.supportingReferences.memoryIds).toEqual([keep.id]);
    expect(corrected.snapshot?.summary).not.toContain("Confirmed: Mark is vegetarian.");
  });

  it("derives the summary from records: unchanged records yield a stable summary", async () => {
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

    // The snapshot is a derived cache — there is no path to edit its text
    // independently of the records, so a fresh read returns the same prose.
    expect(second.status).toBe("fresh");
    expect(second.snapshot?.summary).toBe(first.snapshot?.summary);
  });
});
