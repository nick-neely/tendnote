import { describe, expect, it, vi } from "vitest";
import { createInMemoryContactMethodStore as createContactMethodStore } from "../contact-methods";
import { createInMemoryPeopleStore, createPeopleQueries } from "../people";
import {
  createFakeContactImportFuzzyMatcher,
  createFakeContactImportPreviewAdapter,
} from "./fake-adapter";
import { applyContactImportCandidates, createContactImportPreviewSession } from "./service";
import {
  advisoryFixture,
  driftedMaraContacts,
  MARA_EMAIL,
  maraEmailFixture,
  maraEmailMethodSeed,
  OWNER,
  type PreviewFixture,
  peopleBehindSearchPage,
  personFixture,
  phoneMatchFixture,
  phoneMethodSeed,
  sharedEmailFixture,
} from "./test-fixtures";
import type {
  ContactImportApplyDeps,
  ContactImportCandidateConfirmation,
  ContactImportPreviewCandidate,
  ContactImportPreviewDeps,
  ContactImportPreviewSession,
  ContactImportProviderReferenceInput,
  GoogleContactsPreviewContact,
} from "./types";

/** Confirmation for one previewed candidate, carrying its reviewed fingerprint. */
function confirmationFor(
  candidate: Pick<ContactImportPreviewCandidate, "id" | "fingerprint"> | undefined,
  extra: Partial<ContactImportCandidateConfirmation> = {},
): ContactImportCandidateConfirmation {
  return {
    candidateId: candidate?.id ?? "",
    expectedFingerprint: candidate?.fingerprint ?? "",
    ...extra,
  };
}

/** Confirmations for every safe-bulk-eligible row in a preview. */
function safeConfirmations(
  preview: ContactImportPreviewSession,
): ContactImportCandidateConfirmation[] {
  return preview.candidates
    .filter((candidate) => candidate.safeBulkEligible)
    .map((candidate) => confirmationFor(candidate));
}

function createDeps(
  input: PreviewFixture,
): ContactImportPreviewDeps & { peopleStore: ReturnType<typeof createInMemoryPeopleStore> } {
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
    const deps = createDeps({ people: peopleBehindSearchPage(55) });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]).toMatchObject({
      displayName: "Mara Chen",
      priority: "existing_person_match",
      matchedPerson: { id: "person-mara", displayName: "Mara Chen" },
    });
    expect(session.candidates[0]?.reasons).toContain("Matches Mara Chen by saved contact method");
  });

  it("uses normalized email and strong phone signals for deterministic matches", async () => {
    const deps = createDeps(phoneMatchFixture());

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
    const deps = createDeps(sharedEmailFixture());

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
          emails: [MARA_EMAIL],
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
          emails: [MARA_EMAIL],
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
        maraEmailMethodSeed(),
        phoneMethodSeed({ id: "cm-phone", personId: "person-phone", value: "+13125557777" }),
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
    const deps = createDeps({
      contacts: [{ providerContactId: "people/fuzzy", displayName: "M Chen" }],
      people: peopleBehindSearchPage(75),
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

  it("surfaces provider preview errors without returning candidates", async () => {
    const deps = {
      ...createDeps({}),
      adapter: {
        fetchContacts: vi
          .fn()
          .mockRejectedValue(new Error("Google Contacts preview failed with status 403.")),
      },
    };

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session).toMatchObject({
      connected: true,
      fetchedCount: 0,
      shownCount: 0,
      errorMessage: "Google Contacts preview failed with status 403.",
      candidates: [],
    });
  });

  it("surfaces provider errors during apply without durable writes", async () => {
    const deps = {
      ...createApplyDeps({}),
      adapter: {
        fetchContacts: vi
          .fn()
          .mockRejectedValue(new Error("Google Contacts preview failed with status 401.")),
      },
    };

    const result = await applyContactImportCandidates(
      { ownerUserId: OWNER, confirmations: [] },
      deps,
    );

    expect(result).toMatchObject({
      importedCount: 0,
      errorMessage: "Google Contacts preview failed with status 401.",
    });
    expect(deps.providerRefs).toEqual([]);
    expect(deps.contactAuditEntries).toEqual([]);
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

  it("does not expose unconfirmed preview rows as durable search-visible people", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/preview-only",
          displayName: "Preview Only",
          emails: ["preview-only@example.com"],
          birthday: "--10-31",
        },
      ],
      people: [],
      contactMethods: [],
    });

    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(preview.candidates[0]).toMatchObject({
      displayName: "Preview Only",
      safeBulkEligible: false,
    });
    await expect(
      deps.searchPeople({ ownerUserId: OWNER, query: "Preview Only", limit: 10 }),
    ).resolves.toEqual([]);
    expect(deps.providerRefs).toEqual([]);
    expect(deps.contactAuditEntries).toEqual([]);
  });

  it("bulk-applies safe existing-person candidates with missing fields and provenance", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/safe-existing",
          displayName: "Mara Chen",
          emails: [MARA_EMAIL],
          phones: ["+1 (312) 555-0101"],
          birthday: "--04-18",
        },
      ],
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
      contactMethods: [maraEmailMethodSeed()],
    });

    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);
    const result = await applyContactImportCandidates(
      { ownerUserId: OWNER, confirmations: safeConfirmations(preview) },
      deps,
    );

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

  it("persists only minimized relationship data when adapter input contains raw-provider-shaped extras", async () => {
    const rawProviderExtras = {
      etag: "etag-secret",
      biographies: [{ value: "raw provider biography" }],
      photos: [{ url: "https://people.example/photo" }],
      metadata: { sources: [{ id: "raw-source" }] },
    };
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/raw-extra",
          displayName: "Raw Extra",
          emails: ["raw-extra@example.com"],
          ...rawProviderExtras,
        } as GoogleContactsPreviewContact,
      ],
      people: [],
      contactMethods: [],
    });
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    const result = await applyContactImportCandidates(
      {
        ownerUserId: OWNER,
        mode: "explicit",
        confirmations: [
          confirmationFor(preview.candidates[0], { action: "apply", createPerson: true }),
        ],
      },
      deps,
    );

    expect(result.importedCount).toBe(1);
    expect(result).toMatchObject({ createdPeople: 1, addedContactMethods: 1 });
    const [created] = await deps.searchPeople({
      ownerUserId: OWNER,
      query: "Raw Extra",
      limit: 10,
    });
    expect(created).toMatchObject({ displayName: "Raw Extra", source: "contact_import" });
    expect(deps.providerRefs[0]).toMatchObject({
      ownerUserId: OWNER,
      personId: created?.id,
      providerKey: "google",
      providerContactId: "people/raw-extra",
    });
    expect(JSON.stringify(created)).not.toContain("etag-secret");
    expect(JSON.stringify(created)).not.toContain("raw provider biography");
    expect(JSON.stringify(deps.providerRefs)).not.toContain("raw provider biography");
    expect(JSON.stringify(deps.contactAuditEntries)).not.toContain("etag-secret");
    expect(JSON.stringify(deps.contactAuditEntries)).not.toContain("raw provider biography");
    expect(JSON.stringify(deps.contactAuditEntries)).not.toContain("people.example/photo");
    expect(JSON.stringify(deps.contactAuditEntries)).not.toContain("raw-source");
  });

  it("skips contact methods that become owner-wide duplicates at write time", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/safe-existing",
          displayName: "Mara Chen",
          emails: [MARA_EMAIL],
          phones: ["+1 (312) 555-0101"],
        },
      ],
      people: [
        personFixture({ id: "person-mara", displayName: "Mara Chen" }),
        personFixture({ id: "person-other", displayName: "Other Person" }),
      ],
      contactMethods: [maraEmailMethodSeed()],
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

    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);
    const result = await applyContactImportCandidates(
      { ownerUserId: OWNER, confirmations: safeConfirmations(preview) },
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
      {
        ownerUserId: OWNER,
        mode: "explicit",
        confirmations: [
          confirmationFor(preview.candidates[0], { action: "apply", createPerson: true }),
        ],
      },
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

  it("reports a skipped birthday honestly when a new person is created without one", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/new-skip-birthday",
          displayName: "Skip Birthday",
          emails: ["skip-birthday@example.com"],
          birthday: "--03-14",
        },
      ],
      people: [],
      contactMethods: [],
    });
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    const result = await applyContactImportCandidates(
      {
        ownerUserId: OWNER,
        mode: "explicit",
        confirmations: [
          confirmationFor(preview.candidates[0], {
            action: "apply",
            createPerson: true,
            birthdayChoice: "skip",
          }),
        ],
      },
      deps,
    );

    // The create wrote no birthday, so the outcome, the tally, and the audit entry
    // must all say so — a skipped birthday is never reported as added.
    expect(result).toMatchObject({ importedCount: 1, createdPeople: 1, addedBirthdays: 0 });
    expect(result.candidates[0]).toMatchObject({
      createdPerson: true,
      addedBirthday: null,
      skipped: ["birthday"],
    });
    expect(deps.contactAuditEntries[0]?.metadataJson).toMatchObject({
      createdPerson: true,
      addedBirthday: null,
    });

    const [created] = await deps.searchPeople({
      ownerUserId: OWNER,
      query: "Skip Birthday",
      limit: 10,
    });
    expect(created?.birthday).toBeNull();
  });

  it("does not create a fallback person when an explicit target ID is invalid", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/new",
          displayName: "New Friend",
          emails: ["new@example.com"],
        },
      ],
      people: [],
      contactMethods: [],
    });
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    const result = await applyContactImportCandidates(
      {
        ownerUserId: OWNER,
        mode: "explicit",
        confirmations: [
          confirmationFor(preview.candidates[0], {
            action: "apply",
            targetPersonId: "person-other-owner-or-typo",
            createPerson: true,
          }),
        ],
      },
      deps,
    );

    expect(result.importedCount).toBe(0);
    await expect(
      deps.searchPeople({ ownerUserId: OWNER, query: "New Friend", limit: 10 }),
    ).resolves.toEqual([]);
    expect(deps.providerRefs).toEqual([]);
  });

  it("does not apply conflicts, ambiguous duplicates, weak rows, or advisory matches", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/conflict",
          displayName: "Mara Chen",
          emails: [MARA_EMAIL],
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
        mode: "explicit",
        confirmations: preview.candidates.map((candidate) =>
          confirmationFor(candidate, { action: "apply" }),
        ),
      },
      deps,
    );

    expect(result.importedCount).toBe(0);
    expect(deps.providerRefs).toEqual([]);
    expect(deps.contactAuditEntries).toEqual([]);
  });

  it("applies a conflicting birthday only when the user chooses the provider value", async () => {
    const deps = createApplyDeps({
      contacts: [
        {
          providerContactId: "people/conflict",
          displayName: "Mara Chen",
          emails: [MARA_EMAIL],
          birthday: "--05-20",
        },
      ],
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen", birthday: "--04-18" })],
      contactMethods: [maraEmailMethodSeed()],
    });
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    const result = await applyContactImportCandidates(
      {
        ownerUserId: OWNER,
        mode: "explicit",
        confirmations: [
          confirmationFor(preview.candidates[0], {
            action: "apply",
            targetPersonId: "person-mara",
            birthdayChoice: "provider",
          }),
        ],
      },
      deps,
    );

    expect(result).toMatchObject({
      importedCount: 1,
      updatedPeople: 1,
      addedBirthdays: 1,
    });
    await expect(
      deps.peopleStore.getPerson({ ownerUserId: OWNER, personId: "person-mara" }),
    ).resolves.toMatchObject({
      birthday: "--05-20",
    });
    expect(deps.contactAuditEntries[0]?.metadataJson).toMatchObject({
      resolution: { targetPersonId: "person-mara", birthdayChoice: "provider" },
    });
  });

  it("links advisory candidates only after an explicit target-person choice", async () => {
    const deps = createApplyDeps(advisoryFixture());
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    const result = await applyContactImportCandidates(
      {
        ownerUserId: OWNER,
        mode: "explicit",
        confirmations: [
          confirmationFor(preview.candidates[0], {
            action: "apply",
            targetPersonId: "person-mara",
          }),
        ],
      },
      deps,
    );

    expect(result).toMatchObject({
      importedCount: 1,
      createdPeople: 0,
      updatedPeople: 1,
      addedContactMethods: 1,
    });
    expect(deps.providerRefs[0]).toMatchObject({
      personId: "person-mara",
      providerContactId: "people/advisory",
    });
  });

  it("skips explicitly dismissed candidates without durable relationship writes", async () => {
    const deps = createApplyDeps({
      contacts: [
        { providerContactId: "people/skip", displayName: "Skip Me", emails: ["skip@example.com"] },
      ],
      people: [],
      contactMethods: [],
    });
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    const result = await applyContactImportCandidates(
      {
        ownerUserId: OWNER,
        mode: "explicit",
        confirmations: [confirmationFor(preview.candidates[0], { action: "skip" })],
      },
      deps,
    );

    expect(result.importedCount).toBe(0);
    await expect(
      deps.searchPeople({ ownerUserId: OWNER, query: "Skip", limit: 10 }),
    ).resolves.toEqual([]);
    expect(deps.providerRefs).toEqual([]);
    expect(deps.contactAuditEntries).toEqual([]);
    expect(result.notImported).toEqual([
      { candidateId: preview.candidates[0]?.id, reason: "skipped" },
    ]);
  });
});

describe("Contact Import workflow decisions", () => {
  it("exposes only the safe one-click decision for a strong existing match", async () => {
    const deps = createDeps(phoneMatchFixture());

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]?.safeBulkEligible).toBe(true);
    expect(session.candidates[0]?.decisions).toEqual({
      targets: [{ personId: "person-phone", label: "Phone Match", kind: "matched" }],
      targetChoiceRequired: false,
      canCreatePerson: false,
      birthdayChoiceRequired: false,
      resolvable: true,
    });
  });

  it("requires a birthday choice but preselects the single known target on a conflict", async () => {
    const deps = createDeps({
      contacts: [
        {
          providerContactId: "people/birthday-conflict",
          displayName: "Mara Chen",
          emails: [MARA_EMAIL],
          birthday: "--05-20",
        },
      ],
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen", birthday: "--04-18" })],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]?.safeBulkEligible).toBe(false);
    expect(session.candidates[0]?.decisions).toMatchObject({
      targetChoiceRequired: false,
      birthdayChoiceRequired: true,
      canCreatePerson: false,
      targets: [{ personId: "person-mara", kind: "matched" }],
    });
  });

  it("requires an explicit target choice for advisory-only possible matches", async () => {
    const deps = createDeps({
      contacts: [
        { providerContactId: "people/fuzzy", displayName: "M Chen", emails: ["mchen@example.com"] },
      ],
      people: [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
      contactMethods: [],
      fuzzyMatcher: createFakeContactImportFuzzyMatcher({
        "people/fuzzy": [
          {
            personId: "person-mara",
            displayName: "Mara Chen",
            confidence: "high",
            reason: "Similar name and shared email initials",
          },
        ],
      }),
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]?.decisions).toEqual({
      targets: [
        {
          personId: "person-mara",
          label: "Mara Chen (Similar name and shared email initials)",
          kind: "advisory",
        },
      ],
      targetChoiceRequired: true,
      canCreatePerson: false,
      birthdayChoiceRequired: false,
      resolvable: true,
    });
  });

  it("allows creating a new person for individual-review rows with no match", async () => {
    const deps = createDeps({
      contacts: [
        { providerContactId: "people/new", displayName: "New Friend", emails: ["new@example.com"] },
      ],
      people: [],
      contactMethods: [],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]?.decisions).toMatchObject({
      targets: [],
      targetChoiceRequired: false,
      canCreatePerson: true,
      resolvable: true,
    });
  });

  it("marks an ambiguous multi-person duplicate as skip-only", async () => {
    const deps = createDeps(sharedEmailFixture());

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]?.decisions).toEqual({
      targets: [],
      targetChoiceRequired: false,
      canCreatePerson: false,
      birthdayChoiceRequired: false,
      resolvable: false,
    });
  });

  it("allows creating a new person for weak-match rows with no usable signal", async () => {
    const deps = createDeps({
      contacts: [{ providerContactId: "people/weak", displayName: "Neighborhood Bakery" }],
      people: [],
      contactMethods: [],
    });

    const session = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);

    expect(session.candidates[0]?.reviewState).toBe("weak_match");
    expect(session.candidates[0]?.safeBulkEligible).toBe(false);
    expect(session.candidates[0]?.decisions).toEqual({
      targets: [],
      targetChoiceRequired: false,
      canCreatePerson: true,
      birthdayChoiceRequired: false,
      resolvable: true,
    });
  });
});

describe("Contact Import apply drift guard and reconciliation", () => {
  it("refuses a confirmation when provider data drifts after the owner reviewed it", async () => {
    const deps = createApplyDeps(maraEmailFixture());
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);
    const reviewed = preview.candidates[0];
    expect(reviewed?.safeBulkEligible).toBe(true);

    // The provider now returns an extra phone the owner never saw.
    deps.adapter = createFakeContactImportPreviewAdapter(driftedMaraContacts());

    const result = await applyContactImportCandidates(
      { ownerUserId: OWNER, confirmations: [confirmationFor(reviewed)] },
      deps,
    );

    expect(result.importedCount).toBe(0);
    expect(result.notImported).toEqual([{ candidateId: reviewed?.id, reason: "stale" }]);
    expect(deps.providerRefs).toEqual([]);
    expect(deps.contactAuditEntries).toEqual([]);
  });

  it("applies the reviewed decision when the fingerprint still matches", async () => {
    const deps = createApplyDeps(maraEmailFixture({ contact: { phones: ["+1 (312) 555-0101"] } }));
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);
    const reviewed = preview.candidates[0];

    const result = await applyContactImportCandidates(
      { ownerUserId: OWNER, confirmations: [confirmationFor(reviewed)] },
      deps,
    );

    expect(result).toMatchObject({ importedCount: 1, addedContactMethods: 1 });
    expect(result.notImported).toEqual([]);
  });

  it("refuses to attach to a target the workflow never offered", async () => {
    const deps = createApplyDeps(
      maraEmailFixture({
        contact: { birthday: "--05-20" },
        people: [
          personFixture({ id: "person-mara", displayName: "Mara Chen", birthday: "--04-18" }),
          personFixture({ id: "person-bob", displayName: "Unrelated Bob" }),
        ],
      }),
    );
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);
    const reviewed = preview.candidates[0];

    const result = await applyContactImportCandidates(
      {
        ownerUserId: OWNER,
        mode: "explicit",
        confirmations: [
          confirmationFor(reviewed, { action: "apply", targetPersonId: "person-bob" }),
        ],
      },
      deps,
    );

    expect(result.importedCount).toBe(0);
    expect(result.notImported).toEqual([{ candidateId: reviewed?.id, reason: "missing_target" }]);
    expect(deps.providerRefs).toEqual([]);
  });

  it("reconciles unknown, ineligible, and imported candidates in one honest result", async () => {
    const deps = createApplyDeps(advisoryFixture());
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);
    const advisory = preview.candidates[0];

    const result = await applyContactImportCandidates(
      {
        ownerUserId: OWNER,
        mode: "explicit",
        confirmations: [
          // Advisory row applied with the chosen target: imported.
          confirmationFor(advisory, { action: "apply", targetPersonId: "person-mara" }),
          // Never present in the fresh preview: unknown.
          {
            candidateId: "not-a-real-candidate",
            expectedFingerprint: "fp-missing",
            action: "apply",
            createPerson: true,
          },
        ],
      },
      deps,
    );

    expect(result.importedCount).toBe(1);
    expect(result.notImported).toEqual([
      { candidateId: "not-a-real-candidate", reason: "unknown" },
    ]);
  });

  it("refuses a stale row again on retry without a refresh (no write)", async () => {
    const deps = createApplyDeps(maraEmailFixture());
    const preview = await createContactImportPreviewSession({ ownerUserId: OWNER }, deps);
    const reviewed = preview.candidates[0];

    // Provider drifts, then the owner retries with the same reviewed fingerprint
    // (no refresh) twice: both attempts must be refused and never write.
    deps.adapter = createFakeContactImportPreviewAdapter(driftedMaraContacts());

    const first = await applyContactImportCandidates(
      { ownerUserId: OWNER, confirmations: [confirmationFor(reviewed)] },
      deps,
    );
    const second = await applyContactImportCandidates(
      { ownerUserId: OWNER, confirmations: [confirmationFor(reviewed)] },
      deps,
    );

    expect(first.notImported).toEqual([{ candidateId: reviewed?.id, reason: "stale" }]);
    expect(second.notImported).toEqual([{ candidateId: reviewed?.id, reason: "stale" }]);
    expect(first.importedCount).toBe(0);
    expect(second.importedCount).toBe(0);
    expect(deps.providerRefs).toEqual([]);
    expect(deps.contactAuditEntries).toEqual([]);
  });
});
