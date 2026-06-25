import type { MemoryStatus, Sensitivity, SourceRecordStatus } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryFollowupStore } from "../followups/in-memory-store";
import { createInMemoryMemoryStore } from "../memories/in-memory-store";
import { createPersonContextSnapshot } from "./builder";
import { createInMemoryContextSnapshotStore } from "./in-memory-store";
import type { PersonContextSnapshotStore } from "./types";

const OWNER = "user-1";

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
    birthday: null,
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
    const sourceRecord = await memoryStore.createSourceRecord({
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
      await memoryStore.linkSourceRecordPerson({
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

    return memoryStore.createMemory({
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

  return { store, reader, person, seedMemory, seedSourceRecord };
}

describe("snapshot trust policy", () => {
  it("renders approved memories as confirmed context and source records as logged context", async () => {
    const { reader, person, seedMemory, seedSourceRecord } = await setup();
    const approved = await seedMemory({ content: "Mark is vegetarian.", status: "approved" });
    const source = await seedSourceRecord({ content: "Had lunch with Mark on Tuesday." });

    const { snapshot } = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(snapshot?.summary).toContain("Confirmed: Mark is vegetarian.");
    expect(snapshot?.summary.toLowerCase()).toContain("you noted");
    expect(snapshot?.summary).toContain("Had lunch with Mark on Tuesday.");
    expect(snapshot?.supportingReferences.memoryIds).toContain(approved.id);
    expect(snapshot?.supportingReferences.sourceRecordIds).toContain(source.id);
  });

  it("keeps suggested memories out of the durable summary but preserves them as references", async () => {
    const { reader, person, seedMemory } = await setup();
    const suggested = await seedMemory({
      content: "Mark might be changing jobs.",
      status: "suggested",
    });

    const { snapshot } = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    // Nothing is stated as a confirmed fact, and the suggested memory is not in
    // the approved-memory references — only in the separated suggested list.
    expect(snapshot?.summary).not.toContain("Confirmed:");
    expect(snapshot?.supportingReferences.memoryIds).toEqual([]);
    expect(snapshot?.supportingReferences.suggestedMemoryIds).toEqual([suggested.id]);
  });

  it("excludes restricted content from the default snapshot, even in references", async () => {
    const { reader, person, seedMemory, seedSourceRecord } = await setup();
    await seedMemory({
      content: "Mark is in therapy.",
      status: "approved",
      sensitivity: "restricted",
    });
    await seedSourceRecord({ content: "Sensitive health note.", sensitivity: "restricted" });

    const { snapshot, context } = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(snapshot?.summary).not.toContain("therapy");
    expect(snapshot?.summary).not.toContain("Sensitive health note.");
    expect(snapshot?.supportingReferences.memoryIds).toEqual([]);
    expect(snapshot?.supportingReferences.sourceRecordIds).toEqual([]);
    // Default (proactive) context also withholds restricted records.
    expect(context.approvedMemories).toEqual([]);
    expect(context.sourceRecords).toEqual([]);
  });

  it("serves directly-requested restricted context live without baking it into the cache", async () => {
    const { reader, person, seedMemory } = await setup();
    await seedMemory({
      content: "Mark is in therapy.",
      status: "approved",
      sensitivity: "restricted",
    });

    const requested = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
      directlyRequested: true,
    });

    // Live retrieval surfaces the restricted memory for grounding...
    expect(requested.context.approvedMemories.map((memory) => memory.content)).toContain(
      "Mark is in therapy.",
    );
    // ...but the persisted snapshot stays restricted-free.
    expect(requested.snapshot?.summary).not.toContain("therapy");
    expect(requested.snapshot?.supportingReferences.memoryIds).toEqual([]);

    // A later default read still sees a clean cached snapshot.
    const proactive = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });
    expect(proactive.snapshot?.summary).not.toContain("therapy");
    expect(proactive.snapshot?.supportingReferences.memoryIds).toEqual([]);
  });

  it("excludes dismissed and archived memories from the durable summary", async () => {
    const { reader, person, seedMemory } = await setup();
    const keep = await seedMemory({ content: "Mark loves hiking.", status: "approved" });
    await seedMemory({ content: "Dismissed fact.", status: "dismissed" });
    await seedMemory({ content: "Archived fact.", status: "archived" });

    const { snapshot } = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    // Only the approved memory is referenced and stated as a confirmed fact.
    expect(snapshot?.supportingReferences.memoryIds).toEqual([keep.id]);
    expect(snapshot?.summary).toContain("Confirmed: Mark loves hiking.");
    expect(snapshot?.summary).not.toContain("Confirmed: Dismissed fact.");
    expect(snapshot?.summary).not.toContain("Confirmed: Archived fact.");
  });

  it("excludes pending, archived, and unlinked source records from the snapshot", async () => {
    const { reader, person, seedSourceRecord } = await setup();
    const activeSource = await seedSourceRecord({ content: "Active linked note." });
    await seedSourceRecord({ content: "Pending note.", status: "pending_resolution" });
    await seedSourceRecord({ content: "Archived note.", status: "archived" });
    await seedSourceRecord({ content: "Unlinked note.", link: false });

    const { snapshot } = await reader.getPersonContextSnapshot({
      ownerUserId: OWNER,
      personId: person.id,
    });

    expect(snapshot?.supportingReferences.sourceRecordIds).toEqual([activeSource.id]);
    expect(snapshot?.summary).toContain("Active linked note.");
    expect(snapshot?.summary).not.toContain("Pending note.");
    expect(snapshot?.summary).not.toContain("Archived note.");
    expect(snapshot?.summary).not.toContain("Unlinked note.");
  });

  it("is owner-scoped: another owner cannot read the snapshot or its context", async () => {
    const { reader, person, seedMemory } = await setup();
    await seedMemory({ content: "Mark is vegetarian.", status: "approved" });
    await reader.getPersonContextSnapshot({ ownerUserId: OWNER, personId: person.id });

    const intruder = await reader.getPersonContextSnapshot({
      ownerUserId: "intruder",
      personId: person.id,
    });

    expect(intruder.snapshot).toBeNull();
    expect(intruder.context.person).toBeNull();
    expect(intruder.context.approvedMemories).toEqual([]);
  });
});
