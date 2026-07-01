import { describe, expect, it } from "vitest";
import { createInMemoryPeopleStore } from "./people/in-memory-store";
import { createPeopleQueries } from "./people/queries";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

function createPersonFixture(input: { id: string; ownerUserId: string; displayName: string }) {
  const now = new Date("2026-06-25T12:00:00.000Z");

  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    displayName: input.displayName,
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend" as const,
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual" as const,
    createdAt: now,
    updatedAt: now,
  };
}

describe("people queries", () => {
  it("creates people through the store and records an audit entry", async () => {
    const store = createInMemoryPeopleStore();
    const people = createPeopleQueries(store);

    const person = await people.createPerson({
      ownerUserId: OWNER,
      displayName: "Mark",
    });

    expect(person.ownerUserId).toBe(OWNER);
    expect(person.displayName).toBe("Mark");
    expect(person.relationshipType).toBe("other");

    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toMatchObject([
      {
        action: "person.create",
        entityType: "person",
        entityId: person.id,
        metadataJson: { displayName: "Mark", source: "manual" },
      },
    ]);
  });

  it("updates only the provided profile fields and records an audit entry", async () => {
    const store = createInMemoryPeopleStore({
      people: [createPersonFixture({ id: "p1", ownerUserId: OWNER, displayName: "Mara" })],
    });
    const people = createPeopleQueries(store);

    const updated = await people.updatePerson({
      ownerUserId: OWNER,
      personId: "p1",
      displayName: "Mara Lin",
      birthday: "1990-03-03",
    });

    expect(updated?.displayName).toBe("Mara Lin");
    expect(updated?.birthday).toBe("1990-03-03");
    // Untouched fields are preserved.
    expect(updated?.relationshipType).toBe("friend");
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(
      new Date("2026-06-25T12:00:00.000Z").getTime(),
    );

    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toMatchObject([
      {
        action: "person.update",
        entityType: "person",
        entityId: "p1",
        metadataJson: { fields: ["displayName", "birthday"] },
      },
    ]);
  });

  it("clears a nullable field when passed null", async () => {
    const store = createInMemoryPeopleStore({
      people: [
        {
          ...createPersonFixture({ id: "p1", ownerUserId: OWNER, displayName: "Mara" }),
          profileBlurb: "old blurb",
        },
      ],
    });
    const people = createPeopleQueries(store);

    const updated = await people.updatePerson({
      ownerUserId: OWNER,
      personId: "p1",
      profileBlurb: null,
    });

    expect(updated?.profileBlurb).toBeNull();
  });

  it("does not update another owner's person and writes no audit entry", async () => {
    const store = createInMemoryPeopleStore({
      people: [createPersonFixture({ id: "p1", ownerUserId: OWNER, displayName: "Mara" })],
    });
    const people = createPeopleQueries(store);

    await expect(
      people.updatePerson({ ownerUserId: OTHER_OWNER, personId: "p1", displayName: "Hacked" }),
    ).resolves.toBeNull();
    await expect(store.listAuditLogEntries({ ownerUserId: OTHER_OWNER })).resolves.toEqual([]);
  });

  it("rejects an empty patch and an invalid birthday", async () => {
    const people = createPeopleQueries(
      createInMemoryPeopleStore({
        people: [createPersonFixture({ id: "p1", ownerUserId: OWNER, displayName: "Mara" })],
      }),
    );

    await expect(people.updatePerson({ ownerUserId: OWNER, personId: "p1" })).rejects.toThrow();
    await expect(
      people.updatePerson({ ownerUserId: OWNER, personId: "p1", birthday: "March 3" }),
    ).rejects.toThrow();
  });

  it("deletes a person, cascades their owned rows, and records an audit entry", async () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    const store = createInMemoryPeopleStore({
      people: [
        createPersonFixture({ id: "p1", ownerUserId: OWNER, displayName: "Mara" }),
        createPersonFixture({ id: "keep", ownerUserId: OWNER, displayName: "Sam" }),
      ],
      memories: [
        {
          id: "m1",
          personId: "p1",
          ownerUserId: OWNER,
          sourceRecordId: "s1",
          memoryType: "context",
          content: "Likes hiking",
          status: "approved",
          importance: 3,
          sensitivity: "normal",
          confidence: "medium",
          scope: "private",
          createdAt: now,
          updatedAt: now,
        },
      ],
      followups: [
        {
          id: "f1",
          personId: "p1",
          ownerUserId: OWNER,
          reason: "Check in",
          dueAt: now,
          status: "open",
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const people = createPeopleQueries(store);

    const removed = await people.deletePerson({ ownerUserId: OWNER, personId: "p1" });

    expect(removed?.id).toBe("p1");
    // The person is gone; another owner's — and this owner's other — people remain.
    await expect(
      people.getPersonProfile({ ownerUserId: OWNER, personId: "p1" }),
    ).resolves.toBeNull();
    const kept = await people.getPersonProfile({ ownerUserId: OWNER, personId: "keep" });
    expect(kept?.person.id).toBe("keep");
    // Owned rows cascade away with the person (the store mirrors the DB's foreign keys).
    expect(kept?.memories).toEqual([]);
    expect(kept?.followups).toEqual([]);

    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toMatchObject([
      {
        action: "person.delete",
        entityType: "person",
        entityId: "p1",
        metadataJson: { displayName: "Mara" },
      },
    ]);
  });

  it("does not delete another owner's person and writes no audit entry", async () => {
    const store = createInMemoryPeopleStore({
      people: [createPersonFixture({ id: "p1", ownerUserId: OWNER, displayName: "Mara" })],
    });
    const people = createPeopleQueries(store);

    await expect(
      people.deletePerson({ ownerUserId: OTHER_OWNER, personId: "p1" }),
    ).resolves.toBeNull();
    // The person survives the cross-owner attempt.
    await expect(
      people.getPersonProfile({ ownerUserId: OWNER, personId: "p1" }),
    ).resolves.not.toBeNull();
    await expect(store.listAuditLogEntries({ ownerUserId: OTHER_OWNER })).resolves.toEqual([]);
  });

  it("returns null and writes no audit entry when the person is already gone", async () => {
    const store = createInMemoryPeopleStore();
    const people = createPeopleQueries(store);

    await expect(
      people.deletePerson({ ownerUserId: OWNER, personId: "missing" }),
    ).resolves.toBeNull();
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toEqual([]);
  });

  it("searches only within the requested owner", async () => {
    const people = createPeopleQueries(
      createInMemoryPeopleStore({
        people: [
          createPersonFixture({ id: "owner-sam", ownerUserId: OWNER, displayName: "Sam Lee" }),
          createPersonFixture({
            id: "other-sam",
            ownerUserId: OTHER_OWNER,
            displayName: "Sam Lee",
          }),
        ],
      }),
    );

    const results = await people.searchPeople({ ownerUserId: OWNER, query: "sam" });

    expect(results.map((person) => person.id)).toEqual(["owner-sam"]);
  });

  it("matches first name and last name, not only display name", async () => {
    const people = createPeopleQueries(
      createInMemoryPeopleStore({
        people: [
          {
            ...createPersonFixture({ id: "p1", ownerUserId: OWNER, displayName: "Bob" }),
            firstName: "Robert",
            lastName: "Smith",
          },
        ],
      }),
    );

    await expect(
      people.searchPeople({ ownerUserId: OWNER, query: "robert" }).then((r) => r.map((p) => p.id)),
    ).resolves.toEqual(["p1"]);
    await expect(
      people.searchPeople({ ownerUserId: OWNER, query: "smith" }).then((r) => r.map((p) => p.id)),
    ).resolves.toEqual(["p1"]);
  });

  it("orders search results by display name with a stable id tie-break", async () => {
    const people = createPeopleQueries(
      createInMemoryPeopleStore({
        people: [
          createPersonFixture({ id: "p3", ownerUserId: OWNER, displayName: "Sam Zeta" }),
          // Two people share a display name (seeded out of id order) so the id
          // tie-break — the reason the drizzle order gained `, people.id` — is exercised.
          createPersonFixture({ id: "b-dup", ownerUserId: OWNER, displayName: "Sam Alpha" }),
          createPersonFixture({ id: "a-dup", ownerUserId: OWNER, displayName: "Sam Alpha" }),
          createPersonFixture({ id: "p2", ownerUserId: OWNER, displayName: "Sam Beta" }),
        ],
      }),
    );

    const results = await people.searchPeople({ ownerUserId: OWNER, query: "sam" });

    expect(results.map((person) => person.id)).toEqual(["a-dup", "b-dup", "p2", "p3"]);
    expect(results.map((person) => person.displayName)).toEqual([
      "Sam Alpha",
      "Sam Alpha",
      "Sam Beta",
      "Sam Zeta",
    ]);
  });

  it("returns null for another owner's profile", async () => {
    const people = createPeopleQueries(
      createInMemoryPeopleStore({
        people: [
          createPersonFixture({ id: "owner-sam", ownerUserId: OWNER, displayName: "Sam Lee" }),
        ],
      }),
    );

    await expect(
      people.getPersonProfile({ ownerUserId: OTHER_OWNER, personId: "owner-sam" }),
    ).resolves.toBeNull();
  });
});
