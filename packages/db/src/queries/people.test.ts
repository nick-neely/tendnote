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
