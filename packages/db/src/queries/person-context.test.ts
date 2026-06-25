import type { MemoryStatus, Sensitivity, SourceRecordStatus } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryMemoryStore } from "./memories/in-memory-store";
import { createPersonContext } from "./person-context";

const OWNER = "user-1";

async function setup() {
  const store = createInMemoryMemoryStore();
  const context = createPersonContext(store);

  const person = await store.createPerson({
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

  async function seedSourceRecord(input: {
    content: string;
    status?: SourceRecordStatus;
    sensitivity?: Sensitivity;
    link?: boolean;
  }) {
    const sourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: input.content,
      rawContent: null,
      retentionPolicy: "retain",
      status: input.status ?? "active",
      confidence: "medium",
      sensitivity: input.sensitivity ?? "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });

    if (input.link !== false) {
      await store.linkSourceRecordPerson({
        sourceRecordId: sourceRecord.id,
        personId: person.id,
        role: "primary",
      });
    }

    return sourceRecord;
  }

  async function seedMemory(input: {
    content: string;
    status: MemoryStatus;
    sensitivity?: Sensitivity;
  }) {
    const sourceRecord = await seedSourceRecord({
      content: `source for: ${input.content}`,
      sensitivity: input.sensitivity,
    });

    return store.createMemory({
      personId: person.id,
      ownerUserId: OWNER,
      sourceRecordId: sourceRecord.id,
      memoryType: "context",
      content: input.content,
      status: input.status,
      importance: 3,
      sensitivity: input.sensitivity ?? "normal",
      confidence: "medium",
      scope: "private",
      approvedAt: input.status === "approved" ? new Date() : null,
    });
  }

  return { store, context, person, seedSourceRecord, seedMemory };
}

describe("trust-aware person context", () => {
  it("returns categorized context for a known person", async () => {
    const { context, person, seedMemory, seedSourceRecord } = await setup();
    await seedMemory({ content: "Mark is vegetarian.", status: "approved" });
    await seedMemory({ content: "Mark might be switching jobs.", status: "suggested" });
    await seedSourceRecord({ content: "Had lunch with Mark; he seemed energized." });

    const result = await context.getPersonContext({ ownerUserId: OWNER, personId: person.id });

    expect(result.person?.id).toBe(person.id);
    expect(result.person?.birthday).toBe("1990-04-12");
    expect(result.approvedMemories.map((memory) => memory.content)).toEqual([
      "Mark is vegetarian.",
    ]);
    expect(result.suggestedMemories.map((memory) => memory.content)).toEqual([
      "Mark might be switching jobs.",
    ]);
    expect(result.sourceRecords.map((sourceRecord) => sourceRecord.content)).toContain(
      "Had lunch with Mark; he seemed energized.",
    );
  });

  it("excludes dismissed and archived memories from context", async () => {
    const { context, person, seedMemory } = await setup();
    await seedMemory({ content: "Keep me.", status: "approved" });
    await seedMemory({ content: "Dismissed.", status: "dismissed" });
    await seedMemory({ content: "Archived.", status: "archived" });

    const result = await context.getPersonContext({ ownerUserId: OWNER, personId: person.id });

    expect(result.approvedMemories.map((memory) => memory.content)).toEqual(["Keep me."]);
    expect(result.suggestedMemories).toEqual([]);
  });

  it("excludes pending personless and non-active source records from context", async () => {
    const { context, person, seedSourceRecord } = await setup();
    await seedSourceRecord({ content: "Active linked note." });
    await seedSourceRecord({ content: "Pending note.", status: "pending_resolution" });
    await seedSourceRecord({ content: "Archived note.", status: "archived" });
    // An active record that is not linked to this person must not appear either.
    await seedSourceRecord({ content: "Unlinked note.", link: false });

    const result = await context.getPersonContext({ ownerUserId: OWNER, personId: person.id });

    expect(result.sourceRecords.map((sourceRecord) => sourceRecord.content)).toEqual([
      "Active linked note.",
    ]);
  });

  it("keeps restricted content out of proactive context unless directly requested", async () => {
    const { context, person, seedMemory, seedSourceRecord } = await setup();
    await seedMemory({
      content: "Mark is in therapy.",
      status: "approved",
      sensitivity: "restricted",
    });
    await seedSourceRecord({ content: "Sensitive health note.", sensitivity: "restricted" });

    const proactive = await context.getPersonContext({ ownerUserId: OWNER, personId: person.id });
    expect(proactive.approvedMemories).toEqual([]);
    expect(proactive.sourceRecords).toEqual([]);

    const requested = await context.getPersonContext({
      ownerUserId: OWNER,
      personId: person.id,
      directlyRequested: true,
    });
    expect(requested.approvedMemories).toHaveLength(1);
    expect(requested.sourceRecords.length).toBeGreaterThan(0);
  });

  it("is owner-scoped: another owner sees nothing", async () => {
    const { context, person, seedMemory } = await setup();
    await seedMemory({ content: "Mark is vegetarian.", status: "approved" });

    const result = await context.getPersonContext({ ownerUserId: "intruder", personId: person.id });

    expect(result.person).toBeNull();
    expect(result.approvedMemories).toEqual([]);
    expect(result.sourceRecords).toEqual([]);
  });
});
