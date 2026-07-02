import type { Person } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import type { InMemoryContactMethodSeed } from "../contact-methods";
import { createInMemoryContactMethodStore as createContactMethodStore } from "../contact-methods";
import { createInMemoryPeopleStore, createPeopleQueries } from "../people";
import {
  createFakeContactImportFuzzyMatcher,
  createFakeContactImportPreviewAdapter,
} from "./fake-adapter";
import { applyContactImportCandidates, createContactImportPreviewSession } from "./service";
import type {
  ContactImportApplyDeps,
  ContactImportFuzzyMatcher,
  ContactImportPreviewDeps,
  ContactImportProviderReferenceInput,
  GoogleContactsPreviewContact,
} from "./types";

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
  contactMethods?: InMemoryContactMethodSeed["contactMethods"];
  fuzzyMatcher?: ContactImportFuzzyMatcher;
}): ContactImportPreviewDeps & { peopleStore: ReturnType<typeof createInMemoryPeopleStore> } {
  const peopleStore = createInMemoryPeopleStore({ people: input.people });
  const people = createPeopleQueries(peopleStore);
  const contactMethods = createContactMethodStore({
    contactMethods: input.contactMethods ?? [
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
    fuzzyMatcher: input.fuzzyMatcher,
    isProviderCapabilityConnected: vi.fn().mockResolvedValue(input.connected ?? true),
    searchPeople: people.searchPeople,
    getPerson: people.getPerson,
    findOwnerContactMethodDuplicates: contactMethods.findOwnerContactMethodDuplicates,
  };
}

function createApplyDeps(input: Parameters<typeof createDeps>[0]): ContactImportApplyDeps & {
  peopleStore: ReturnType<typeof createInMemoryPeopleStore>;
  providerRefs: ContactImportProviderReferenceInput[];
  contactAuditEntries: Array<{ metadataJson: Record<string, unknown> }>;
} {
  const previewDeps = createDeps(input);
  const peopleStore = previewDeps.peopleStore;
  const people = createPeopleQueries(peopleStore);
  const contactMethods = createContactMethodStore({
    contactMethods: input.contactMethods ?? [],
  });
  const providerRefs: ContactImportProviderReferenceInput[] = [];
  const contactAuditEntries: Array<{ metadataJson: Record<string, unknown> }> = [];

  return {
    ...previewDeps,
    findOwnerContactMethodDuplicates: contactMethods.findOwnerContactMethodDuplicates,
    createPerson: people.createPerson,
    updatePerson: people.updatePerson,
    createContactMethod: contactMethods.createContactMethod,
    createProviderReference: async (ref) => {
      providerRefs.push(ref);
    },
    createAuditLogEntry: async (entry) => {
      contactAuditEntries.push({ metadataJson: entry.metadataJson });
    },
    providerRefs,
    contactAuditEntries,
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
      shownCount: 4,
      hiddenCount: 1,
    });
    expect(session.candidates.map((candidate) => candidate.displayName)).toEqual([
      "Mara Chen",
      "Ari Patel",
      "Jordan Lee",
      "Neighborhood Bakery",
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
      matchedPerson: { id: "person-mara", displayName: "Mara Chen" },
    });
    expect(session.candidates[0]?.reasons).toContain("Matches Mara Chen by saved contact method");
  });

  it("uses normalized email and strong phone signals for deterministic matches", async () => {
    const deps = createDeps({
      contacts: [
        {
          providerContactId: "people/phone",
          displayName: "Phone Match",
          phones: ["+1 (312) 555-7777"],
        },
      ],
      people: [personFixture({ id: "person-phone", displayName: "Phone Match" })],
      contactMethods: [
        {
          id: "cm-phone",
          ownerUserId: OWNER,
          personId: "person-phone",
          type: "phone",
          value: "+13125557777",
          normalizedValue: "+13125557777",
          isPrimary: true,
        },
      ],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      priority: "existing_person_match",
      reviewState: "safe_recommendation",
      safeBulkEligible: true,
      matchSignals: [
        {
          type: "phone",
          value: "+13125557777",
          confidence: "strong",
          matchedPersonId: "person-phone",
        },
      ],
    });
  });

  it("flags owner-wide duplicate contact methods across multiple people as ambiguous and not bulk safe", async () => {
    const deps = createDeps({
      contacts: [
        {
          providerContactId: "people/shared",
          displayName: "Shared Email",
          emails: ["shared@example.com"],
        },
      ],
      people: [
        personFixture({ id: "person-one", displayName: "One" }),
        personFixture({ id: "person-two", displayName: "Two" }),
      ],
      contactMethods: [
        {
          id: "cm-one",
          ownerUserId: OWNER,
          personId: "person-one",
          type: "email",
          value: "shared@example.com",
          normalizedValue: "shared@example.com",
          isPrimary: true,
        },
        {
          id: "cm-two",
          ownerUserId: OWNER,
          personId: "person-two",
          type: "email",
          value: "shared@example.com",
          normalizedValue: "shared@example.com",
          isPrimary: true,
        },
      ],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      reviewState: "ambiguous_duplicate",
      safeBulkEligible: false,
      conflicts: [
        {
          type: "duplicate_contact_method",
          message: "This contact method is already attached to more than one Tendnote person.",
        },
      ],
    });
  });

  it("flags existing Tendnote birthday conflicts and excludes them from safe bulk", async () => {
    const deps = createDeps({
      contacts: [
        {
          providerContactId: "people/birthday-conflict",
          displayName: "Mara Chen",
          emails: ["mara.chen@example.com"],
          birthday: "--05-20",
        },
      ],
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen", birthday: "--04-18" })],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      reviewState: "conflict",
      safeBulkEligible: false,
      conflicts: [{ type: "birthday", message: "Tendnote already has birthday --04-18." }],
    });
  });

  it("excludes mixed useful contacts with ambiguous phones from safe bulk", async () => {
    const deps = createDeps({
      contacts: [
        {
          providerContactId: "people/mixed-ambiguous",
          displayName: "Useful But Ambiguous",
          emails: ["useful@example.com"],
          phones: ["555-0100"],
        },
      ],
      people: [],
      contactMethods: [],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      priority: "useful_email",
      reviewState: "individual_review",
      safeBulkEligible: false,
      conflicts: [
        {
          type: "ambiguous_contact_method",
          message: "Review phone number before using it for matching or import.",
        },
      ],
    });
  });

  it("keeps safe recommendations visible separately from higher-scoring review rows", async () => {
    const deps = createDeps({
      contacts: [
        {
          providerContactId: "people/conflict",
          displayName: "Mara Chen",
          emails: ["mara.chen@example.com"],
          phones: ["+1 (312) 555-0101"],
          birthday: "--05-20",
        },
        {
          providerContactId: "people/safe",
          displayName: "Phone Match",
          phones: ["+1 (312) 555-7777"],
        },
      ],
      people: [
        personFixture({ id: "person-mara", displayName: "Mara Chen", birthday: "--04-18" }),
        personFixture({ id: "person-phone", displayName: "Phone Match" }),
      ],
      contactMethods: [
        {
          id: "cm-mara",
          ownerUserId: OWNER,
          personId: "person-mara",
          type: "email",
          value: "mara.chen@example.com",
          normalizedValue: "mara.chen@example.com",
          isPrimary: true,
        },
        {
          id: "cm-phone",
          ownerUserId: OWNER,
          personId: "person-phone",
          type: "phone",
          value: "+13125557777",
          normalizedValue: "+13125557777",
          isPrimary: true,
        },
      ],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER, limit: 1 }, deps);

    expect(session.candidates.map((candidate) => candidate.displayName)).toEqual([
      "Phone Match",
      "Mara Chen",
    ]);
    expect(session.candidates.map((candidate) => candidate.reviewState)).toEqual([
      "safe_recommendation",
      "conflict",
    ]);
  });

  it("marks ambiguous-phone rows as individual-only and not bulk safe", async () => {
    const deps = createDeps({
      contacts: [
        {
          providerContactId: "people/weak",
          displayName: "Printer Support",
          phones: ["555-0100"],
        },
      ],
      people: [],
      contactMethods: [],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      priority: "lower_priority",
      reviewState: "individual_review",
      safeBulkEligible: false,
      matchSignals: [],
    });
  });

  it("marks no-signal rows as weak matches", async () => {
    const deps = createDeps({
      contacts: [{ providerContactId: "people/weak", displayName: "Neighborhood Bakery" }],
      people: [],
      contactMethods: [],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      priority: "lower_priority",
      reviewState: "weak_match",
      safeBulkEligible: false,
      matchSignals: [],
    });
  });

  it("adds advisory fuzzy-ranked possible matches with human-readable reasons", async () => {
    const deps = createDeps({
      contacts: [
        {
          providerContactId: "people/fuzzy",
          displayName: "M Chen",
          emails: ["mchen@example.com"],
        },
      ],
      contactMethods: [],
      fuzzyMatcher: createFakeContactImportFuzzyMatcher({
        "people/fuzzy": [
          {
            personId: "person-mara",
            displayName: "Untrusted Name",
            confidence: "high",
            reason: "Similar name and shared email initials",
          },
          {
            personId: "person-mara-2",
            displayName: "Mara C",
            confidence: "medium",
            reason: "Similar first initial and last name",
          },
        ],
      }),
      people: [
        personFixture({ id: "person-mara", displayName: "Mara Chen" }),
        personFixture({ id: "person-mara-2", displayName: "Mara C" }),
      ],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      displayName: "M Chen",
      reviewState: "advisory_match",
      safeBulkEligible: false,
      matchedPerson: null,
      advisoryMatches: [
        {
          personId: "person-mara",
          displayName: "Mara Chen",
          confidence: "high",
          reason: "Similar name and shared email initials",
        },
        {
          personId: "person-mara-2",
          displayName: "Mara C",
          confidence: "medium",
          reason: "Similar first initial and last name",
        },
      ],
    });
    expect(session.candidates[0]?.reasons).toContain("Possible match: Mara Chen");
  });

  it("filters fuzzy adapter output to owner-scoped people", async () => {
    const deps = createDeps({
      contacts: [{ providerContactId: "people/fuzzy", displayName: "M Chen" }],
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
      contactMethods: [],
      fuzzyMatcher: createFakeContactImportFuzzyMatcher({
        "people/fuzzy": [
          {
            personId: "person-mara",
            displayName: "Wrong Name",
            confidence: "high",
            reason: "Valid local person",
          },
          {
            personId: "person-other-owner",
            displayName: "Other Owner",
            confidence: "high",
            reason: "Should be discarded",
          },
        ],
      }),
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]?.advisoryMatches).toEqual([
      {
        personId: "person-mara",
        displayName: "Mara Chen",
        confidence: "high",
        reason: "Valid local person",
      },
    ]);
  });

  it("can fuzzy-rank possible matches beyond the first 50 people", async () => {
    const people = Array.from({ length: 75 }, (_, index) =>
      personFixture({
        id: `person-${String(index).padStart(2, "0")}`,
        displayName: `Aardvark ${String(index).padStart(2, "0")}`,
      }),
    );
    people.push(personFixture({ id: "person-mara", displayName: "Mara Chen" }));
    const deps = createDeps({
      contacts: [{ providerContactId: "people/fuzzy", displayName: "M Chen" }],
      people,
      contactMethods: [],
      fuzzyMatcher: createFakeContactImportFuzzyMatcher({
        "people/fuzzy": [
          {
            personId: "person-mara",
            displayName: "Mara Chen",
            confidence: "high",
            reason: "Similar name",
          },
        ],
      }),
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      reviewState: "advisory_match",
      advisoryMatches: [{ personId: "person-mara", displayName: "Mara Chen" }],
    });
  });

  it("never lets advisory fuzzy matches auto-link or become bulk eligible", async () => {
    const deps = createDeps({
      contacts: [{ providerContactId: "people/fuzzy", displayName: "Mara?" }],
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
      contactMethods: [],
      fuzzyMatcher: createFakeContactImportFuzzyMatcher({
        "people/fuzzy": [
          {
            personId: "person-mara",
            displayName: "Mara Chen",
            confidence: "high",
            reason: "Name is close",
          },
        ],
      }),
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      reviewState: "advisory_match",
      safeBulkEligible: false,
      matchedPerson: null,
      matchSignals: [],
    });
  });

  it("does not ask fuzzy matching to override deterministic exact matches", async () => {
    const fuzzyMatcher = {
      rankPossibleMatches: vi.fn().mockResolvedValue([
        {
          personId: "person-other",
          displayName: "Other Person",
          confidence: "high",
          reason: "Should not be used",
        },
      ]),
    };
    const deps = createDeps({
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
      fuzzyMatcher,
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(fuzzyMatcher.rankPossibleMatches).not.toHaveBeenCalledWith(
      expect.objectContaining({
        contact: expect.objectContaining({ providerContactId: "people/c1001" }),
      }),
    );
    expect(session.candidates[0]).toMatchObject({
      displayName: "Mara Chen",
      reviewState: "safe_recommendation",
      advisoryMatches: [],
    });
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

  it("bulk-applies safe existing-person candidates with missing fields and provenance", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/safe-existing",
          displayName: "Mara Chen",
          emails: ["mara.chen@example.com"],
          phones: ["+1 (312) 555-0101"],
          birthday: "--04-18",
        },
      ],
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
      contactMethods: [
        {
          id: "cm-mara",
          ownerUserId: OWNER,
          personId: "person-mara",
          type: "email",
          value: "mara.chen@example.com",
          normalizedValue: "mara.chen@example.com",
          isPrimary: true,
        },
      ],
    });

    const result = await applyContactImportCandidates({ ownerUserId: OWNER }, deps);

    expect(result).toMatchObject({
      importedCount: 1,
      createdPeople: 0,
      updatedPeople: 1,
      addedContactMethods: 1,
      addedBirthdays: 1,
      undoAvailable: false,
    });
    expect(result.candidates[0]).toMatchObject({
      personId: "person-mara",
      addedPhones: ["+1 (312) 555-0101"],
      addedBirthday: "--04-18",
      skipped: ["email:mara.chen@example.com"],
    });
    expect(deps.providerRefs).toEqual([
      {
        ownerUserId: OWNER,
        personId: "person-mara",
        providerKey: "google",
        providerContactId: "people/safe-existing",
      },
    ]);
    expect(deps.contactAuditEntries[0]?.metadataJson).toMatchObject({
      providerKey: "google",
      providerContactId: "people/safe-existing",
      personId: "person-mara",
      createdPerson: false,
      addedPhones: ["+1 (312) 555-0101"],
      addedBirthday: "--04-18",
    });
  });

  it("skips contact methods that become owner-wide duplicates at write time", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/safe-existing",
          displayName: "Mara Chen",
          emails: ["mara.chen@example.com"],
          phones: ["+1 (312) 555-0101"],
        },
      ],
      people: [
        personFixture({ id: "person-mara", displayName: "Mara Chen" }),
        personFixture({ id: "person-other", displayName: "Other Person" }),
      ],
      contactMethods: [
        {
          id: "cm-mara",
          ownerUserId: OWNER,
          personId: "person-mara",
          type: "email",
          value: "mara.chen@example.com",
          normalizedValue: "mara.chen@example.com",
          isPrimary: true,
        },
      ],
    });
    const duplicateLookup = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "cm-mara",
          personId: "person-mara",
          type: "email",
          value: "mara.chen@example.com",
          displayValue: "mara.chen@example.com",
          normalizedValue: "mara.chen@example.com",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "cm-other-phone",
          personId: "person-other",
          type: "phone",
          value: "+13125550101",
          displayValue: "+1 (312) 555-0101",
          normalizedValue: "+13125550101",
        },
      ]);

    const result = await applyContactImportCandidates(
      { ownerUserId: OWNER },
      { ...deps, findOwnerContactMethodDuplicates: duplicateLookup },
    );

    expect(result).toMatchObject({
      importedCount: 1,
      addedContactMethods: 0,
    });
    expect(result.candidates[0]?.skipped).toEqual([
      "email:mara.chen@example.com",
      "phone:+1 (312) 555-0101",
    ]);
    expect(deps.contactAuditEntries[0]?.metadataJson).toMatchObject({
      skipped: ["email:mara.chen@example.com", "phone:+1 (312) 555-0101"],
    });
  });

  it("explicitly applies non-conflicting new-person candidates only after confirmation", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/new",
          displayName: "New Friend",
          emails: ["new@example.com"],
          birthday: "--03-14",
        },
      ],
      people: [],
      contactMethods: [],
    });
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(preview.candidates[0]).toMatchObject({
      reviewState: "individual_review",
      safeBulkEligible: false,
    });

    await expect(
      deps.searchPeople({ ownerUserId: OWNER, query: "New Friend", limit: 10 }),
    ).resolves.toEqual([]);

    const result = await applyContactImportCandidates(
      { ownerUserId: OWNER, candidateIds: [preview.candidates[0]?.id ?? ""], mode: "explicit" },
      deps,
    );

    expect(result).toMatchObject({
      importedCount: 1,
      createdPeople: 1,
      addedContactMethods: 1,
      addedBirthdays: 1,
      undoAvailable: false,
    });
    await expect(
      deps.searchPeople({ ownerUserId: OWNER, query: "New Friend", limit: 10 }),
    ).resolves.toHaveLength(1);
    expect(deps.providerRefs[0]).toMatchObject({
      providerKey: "google",
      providerContactId: "people/new",
    });
  });

  it("does not apply conflicts, ambiguous duplicates, weak rows, or advisory matches", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/conflict",
          displayName: "Mara Chen",
          emails: ["mara.chen@example.com"],
          birthday: "--05-20",
        },
        {
          providerContactId: "people/advisory",
          displayName: "M Chen",
        },
      ],
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen", birthday: "--04-18" })],
      fuzzyMatcher: createFakeContactImportFuzzyMatcher({
        "people/advisory": [
          {
            personId: "person-mara",
            displayName: "Mara Chen",
            confidence: "high",
            reason: "Similar name",
          },
        ],
      }),
    });
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    const result = await applyContactImportCandidates(
      {
        ownerUserId: OWNER,
        candidateIds: preview.candidates.map((candidate) => candidate.id),
        mode: "explicit",
      },
      deps,
    );

    expect(result.importedCount).toBe(0);
    expect(deps.providerRefs).toEqual([]);
    expect(deps.contactAuditEntries).toEqual([]);
  });
});
