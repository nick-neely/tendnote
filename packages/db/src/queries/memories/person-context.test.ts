import { canUseMemoryProactively, isDurableMemoryFact } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryMemoryStore, createMemoryCapture } from "../memories";

/** The person's ordinary approved fact, and the one they marked restricted. */
const DENVER_MOVE = "Caleb is moving to Denver in August";
const BETWEEN_JOBS = "Caleb is between jobs right now";

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

/**
 * Caleb with one memory in each half: an ordinary approved fact and an approved fact he
 * marked restricted. Both halves have to be populated for a caller's view of them to say
 * anything - with only one seeded, "withheld" and "absent" look identical from the outside.
 */
async function seedCalebWithBothHalves() {
  const store = createInMemoryMemoryStore();
  const capture = createMemoryCapture(store);
  const caleb = await seedPerson(store, "Caleb");

  await capture.captureExplicitMemory({
    ownerUserId: "user-1",
    personId: caleb.id,
    content: DENVER_MOVE,
  });
  await capture.captureExplicitMemory({
    ownerUserId: "user-1",
    personId: caleb.id,
    content: BETWEEN_JOBS,
    sensitivity: "restricted",
  });

  return { capture, caleb };
}

describe("person memory context", () => {
  it("returns approved memories for a person as confirmed facts", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const caleb = await seedPerson(store, "Caleb");

    await capture.captureExplicitMemory({
      ownerUserId: "user-1",
      personId: caleb.id,
      content: DENVER_MOVE,
    });

    const context = await capture.listPersonMemoryContext({
      ownerUserId: "user-1",
      personId: caleb.id,
    });

    expect(context.person?.id).toBe(caleb.id);
    expect(context.memories).toHaveLength(1);
    expect(context.memories[0]?.content).toBe(DENVER_MOVE);
    expect(context.memories.every(isDurableMemoryFact)).toBe(true);
    expect(context.restrictedMemories).toEqual([]);
  });

  it("holds restricted memories in their own half instead of dropping them", async () => {
    const { capture, caleb } = await seedCalebWithBothHalves();

    const context = await capture.listPersonMemoryContext({
      ownerUserId: "user-1",
      personId: caleb.id,
    });

    // The confirmed half is exactly what a proactive surface may use; the
    // restricted half is everything else that is still an approved fact, so the
    // person's own page can offer it behind a reveal and label the control with
    // a count without showing anything.
    expect(context.memories.map((memory) => memory.content)).toEqual([DENVER_MOVE]);
    expect(context.restrictedMemories.map((memory) => memory.content)).toEqual([BETWEEN_JOBS]);
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
      content: DENVER_MOVE,
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
    const { capture, caleb } = await seedCalebWithBothHalves();

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
      content: DENVER_MOVE,
    });

    const danaContext = await capture.listPersonMemoryContext({
      ownerUserId: "user-1",
      personId: dana.id,
    });

    expect(danaContext.memories).toEqual([]);
  });
});
