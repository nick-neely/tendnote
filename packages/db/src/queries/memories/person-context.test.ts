import { isDurableMemoryFact } from "@tendnote/domain";
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

    const context = await capture.listPersonMemoryContext({
      ownerUserId: "user-2",
      personId: caleb.id,
    });

    expect(context.person).toBeNull();
    expect(context.memories).toEqual([]);
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
