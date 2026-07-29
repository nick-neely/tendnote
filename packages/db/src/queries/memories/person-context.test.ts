import { canUseMemoryProactively, isDurableMemoryFact } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryMemoryStore, createMemoryCapture } from "../memories";

async function seedPerson(
  store: ReturnType<typeof createInMemoryMemoryStore>,
  displayName: string,
) {
  return store.createPerson({
    ownerUserId: "user-1",
    displayName,
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });
}

describe("person memory context", () => {
  it("returns approved memories for a person as confirmed facts", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store, "Caleb");

    await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is moving to Denver in August",
    });

    const context = await capture.listPersonMemoryContext({
      ownerUserId: "user-1",
      personId: caleb.id,
    });

    expect(context.person?.id).toBe(caleb.id);
    expect(context.memories).toHaveLength(1);
    expect(context.memories[0]?.content).toBe("Caleb is moving to Denver in August");
    expect(context.memories.every(isDurableMemoryFact)).toBe(true);
    expect(context.restrictedMemories).toEqual([]);
  });

  it("holds restricted memories in their own half instead of dropping them", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store, "Caleb");

    await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is moving to Denver in August",
    });
    await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is between jobs right now",
      sensitivity: "restricted",
    });

    const context = await capture.listPersonMemoryContext({
      ownerUserId: "user-1",
      personId: caleb.id,
    });

    // The confirmed half is exactly what a proactive surface may use; the
    // restricted half is everything else that is still an approved fact, so the
    // person's own page can offer it behind a reveal and label the control with
    // a count without showing anything.
    expect(context.memories.map((memory) => memory.content)).toEqual([
      "Caleb is moving to Denver in August",
    ]);
    expect(context.restrictedMemories.map((memory) => memory.content)).toEqual([
      "Caleb is between jobs right now",
    ]);
    expect(context.memories.every((memory) => canUseMemoryProactively(memory))).toBe(true);
    expect(context.restrictedMemories.every((memory) => !canUseMemoryProactively(memory))).toBe(
      true,
    );
    expect(context.restrictedMemories.every(isDurableMemoryFact)).toBe(true);
  });

  it("keeps unapproved memories out of both halves", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store, "Caleb");

    const { sourceRecord } = await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is moving to Denver in August",
    });
    await capture.captureSuggestedMemoryFromSource({
      ownerUserId: "user-1",
      personId: caleb.id,
      sourceRecordId: sourceRecord.id,
      content: "Caleb might take the Denver offer",
    });

    const context = await capture.listPersonMemoryContext({
      ownerUserId: "user-1",
      personId: caleb.id,
    });

    // Restricted is not a synonym for "not shown": a suggestion is review work,
    // and revealing it here would put unconfirmed text on the confirmed ledger.
    expect(context.memories).toHaveLength(1);
    expect(context.restrictedMemories).toEqual([]);
  });

  it("scopes memories to the requesting owner", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store, "Caleb");

    await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is moving to Denver in August",
    });
    await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is between jobs right now",
      sensitivity: "restricted",
    });

    const context = await capture.listPersonMemoryContext({
      ownerUserId: "user-2",
      personId: caleb.id,
    });

    // The reveal is the *owner's* affordance: another caller gets neither the
    // rows nor the count that would say how many are being held back.
    expect(context.person).toBeNull();
    expect(context.memories).toEqual([]);
    expect(context.restrictedMemories).toEqual([]);
  });

  it("does not leak one person's memories into another person's context", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store, "Caleb");
    const dana = await seedPerson(store, "Dana");

    await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: "Caleb is moving to Denver in August",
    });

    const danaContext = await capture.listPersonMemoryContext({
      ownerUserId: "user-1",
      personId: dana.id,
    });

    expect(danaContext.memories).toEqual([]);
  });
});
