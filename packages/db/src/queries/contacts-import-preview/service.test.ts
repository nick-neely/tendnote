import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Person } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryContactMethodStore as createContactMethodStore } from "../contact-methods";
import { createInMemoryPeopleStore, createPeopleQueries } from "../people";
import { createFakeContactImportPreviewAdapter } from "./fake-adapter";
import { createContactImportPreviewSession } from "./service";
import type { ContactImportPreviewDeps, GoogleContactsPreviewContact } from "./types";

const OWNER = "owner-1";
const NOW = new Date("2026-01-01T00:00:00Z");

function personFixture(input: Partial<Person> & { id: string; displayName: string }): Person {
  return {
    ownerUserId: OWNER,
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
    createdAt: NOW,
    updatedAt: NOW,
    ...input,
  };
}

function createDeps(input: {
  connected?: boolean;
  contacts?: GoogleContactsPreviewContact[];
  people?: Person[];
}): ContactImportPreviewDeps & { peopleStore: ReturnType<typeof createInMemoryPeopleStore> } {
  const peopleStore = createInMemoryPeopleStore({ people: input.people });
  const people = createPeopleQueries(peopleStore);
  const contactMethods = createContactMethodStore({
    contactMethods: [
      {
        id: "cm-mara",
        ownerUserId: OWNER,
        personId: "person-mara",
        type: "email",
        value: "mara.chen@example.com",
        displayValue: "Mara.Chen@example.com",
        normalizedValue: "mara.chen@example.com",
        isPrimary: true,
      },
    ],
  });

  return {
    peopleStore,
    adapter: createFakeContactImportPreviewAdapter(input.contacts),
    isProviderCapabilityConnected: vi.fn().mockResolvedValue(input.connected ?? true),
    searchPeople: people.searchPeople,
    findOwnerContactMethodDuplicates: contactMethods.findOwnerContactMethodDuplicates,
  };
}

describe("createContactImportPreviewSession", () => {
  it("builds a prioritized preview from fixture Contacts data", async () => {
    const deps = createDeps({
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session).toMatchObject({
      connected: true,
      mode: "prioritized",
      fetchedCount: 5,
      shownCount: 3,
      hiddenCount: 2,
    });
    expect(session.candidates.map((candidate) => candidate.displayName)).toEqual([
      "Mara Chen",
      "Ari Patel",
      "Jordan Lee",
    ]);
    const firstCandidate = session.candidates[0];
    expect(firstCandidate).toMatchObject({
      priority: "existing_person_match",
      matchedPerson: { id: "person-mara", displayName: "Mara Chen" },
    });
    expect(firstCandidate?.reasons).toContain("Matches Mara Chen by saved contact method");
  });

  it("search finds lower-priority fetched rows outside the default preview", async () => {
    const deps = createDeps({
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
    });

    const session = await createContactImportPreviewSession(
      { ownerUserId: OWNER, query: "bakery" },
      deps,
    );

    expect(session).toMatchObject({
      connected: true,
      mode: "search",
      query: "bakery",
      fetchedCount: 5,
      hiddenCount: 0,
      shownCount: 1,
    });
    expect(session.candidates[0]).toMatchObject({
      displayName: "Neighborhood Bakery",
      priority: "lower_priority",
    });
  });

  it("keeps exact owner-wide contact-method matches prioritized even beyond the people search page", async () => {
    const people = Array.from({ length: 55 }, (_, index) =>
      personFixture({
        id: `person-${String(index).padStart(2, "0")}`,
        displayName: `Aardvark ${String(index).padStart(2, "0")}`,
      }),
    );
    people.push(personFixture({ id: "person-mara", displayName: "Mara Chen" }));
    const deps = createDeps({ people });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      displayName: "Mara Chen",
      priority: "existing_person_match",
      matchedPerson: null,
    });
    expect(session.candidates[0]?.reasons).toContain(
      "Matches an existing Tendnote person by saved contact method",
    );
  });

  it("does not fetch fixture contacts when Contacts is disconnected", async () => {
    const fetchContacts = vi.fn();
    const deps = {
      ...createDeps({ connected: false }),
      adapter: { fetchContacts },
    };

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.connected).toBe(false);
    expect(session.candidates).toEqual([]);
    expect(fetchContacts).not.toHaveBeenCalled();
  });

  it("does not write durable relationship data for unconfirmed preview rows", async () => {
    const deps = createDeps({
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
    });

    await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    await expect(deps.peopleStore.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(
      deps.searchPeople({ ownerUserId: OWNER, query: "Ari", limit: 10 }),
    ).resolves.toEqual([]);
    await expect(
      deps.searchPeople({ ownerUserId: OWNER, query: "Mara", limit: 10 }),
    ).resolves.toHaveLength(1);
  });

  it("has no durable write dependencies for unconfirmed previews", () => {
    const source = readFileSync(join(import.meta.dirname, "service.ts"), "utf8");

    for (const forbidden of [
      "createPerson",
      "updatePerson",
      "createMemory",
      "captureMemory",
      "captureSourceRecord",
      "createSourceRecord",
      "createContactMethod",
      "semantic-retrieval",
      "source-records",
      "memories",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
