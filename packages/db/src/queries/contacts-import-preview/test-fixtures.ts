import type { Person } from "@tendnote/domain";
import type { InMemoryContactMethodSeed } from "../contact-methods";
import { createFakeContactImportFuzzyMatcher } from "./fake-adapter";
import type { ContactImportFuzzyMatcher, GoogleContactsPreviewContact } from "./types";

/**
 * Shared Contact Import Preview test fixtures.
 *
 * Each exported scenario names the situation it sets up (a strong phone match, a
 * contact method shared by two people, an advisory-only fuzzy match, a known
 * Mara Chen email match) rather than restating its seed rows. Tests then read as
 * "given this situation, assert this policy", and a fixture that drifts drifts
 * once for every test that depends on it.
 */

export const OWNER = "owner-1";
export const MARA_EMAIL = "mara.chen@example.com";

const NOW = new Date("2026-01-01T00:00:00Z");

type ContactMethodSeed = NonNullable<InMemoryContactMethodSeed["contactMethods"]>[number];

/** The seed a preview or apply dependency set is built from. */
export type PreviewFixture = {
  connected?: boolean;
  contacts?: GoogleContactsPreviewContact[];
  people?: Person[];
  contactMethods?: InMemoryContactMethodSeed["contactMethods"];
  fuzzyMatcher?: ContactImportFuzzyMatcher;
};

export function personFixture(
  input: Partial<Person> & { id: string; displayName: string },
): Person {
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

/**
 * Mara Chen behind enough alphabetically-earlier people to push her past a
 * single people-search page, so matching cannot quietly depend on that page.
 */
export function peopleBehindSearchPage(noiseCount: number): Person[] {
  const people = Array.from({ length: noiseCount }, (_, index) =>
    personFixture({
      id: `person-${String(index).padStart(2, "0")}`,
      displayName: `Aardvark ${String(index).padStart(2, "0")}`,
    }),
  );
  people.push(personFixture({ id: "person-mara", displayName: "Mara Chen" }));
  return people;
}

function emailMethodSeed(input: {
  id: string;
  personId: string;
  value: string;
}): ContactMethodSeed {
  return {
    id: input.id,
    ownerUserId: OWNER,
    personId: input.personId,
    type: "email",
    value: input.value,
    normalizedValue: input.value,
    isPrimary: true,
  };
}

export function phoneMethodSeed(input: {
  id: string;
  personId: string;
  value: string;
}): ContactMethodSeed {
  return {
    id: input.id,
    ownerUserId: OWNER,
    personId: input.personId,
    type: "phone",
    value: input.value,
    normalizedValue: input.value,
    isPrimary: true,
  };
}

export function maraEmailMethodSeed(): ContactMethodSeed {
  return emailMethodSeed({ id: "cm-mara", personId: "person-mara", value: MARA_EMAIL });
}

/** A provider phone that normalizes to a saved method on exactly one person. */
export function phoneMatchFixture(): PreviewFixture {
  return {
    contacts: [
      {
        providerContactId: "people/phone",
        displayName: "Phone Match",
        phones: ["+1 (312) 555-7777"],
      },
    ],
    people: [personFixture({ id: "person-phone", displayName: "Phone Match" })],
    contactMethods: [
      phoneMethodSeed({ id: "cm-phone", personId: "person-phone", value: "+13125557777" }),
    ],
  };
}

/** One email address already attached to two different people. */
export function sharedEmailFixture(): PreviewFixture {
  return {
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
      emailMethodSeed({ id: "cm-one", personId: "person-one", value: "shared@example.com" }),
      emailMethodSeed({ id: "cm-two", personId: "person-two", value: "shared@example.com" }),
    ],
  };
}

/** No deterministic match; only a fuzzy matcher suggesting Mara Chen. */
export function advisoryFixture(): PreviewFixture {
  return {
    contacts: [
      {
        providerContactId: "people/advisory",
        displayName: "M Chen",
        emails: ["mchen@example.com"],
      },
    ],
    people: [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
    contactMethods: [],
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
  };
}

/**
 * A provider contact whose email exactly matches Mara Chen's saved method.
 * `contact` overrides extend the provider row (an extra phone, a birthday);
 * `people` overrides replace the seeded person set.
 */
export function maraEmailFixture(
  overrides: { contact?: Partial<GoogleContactsPreviewContact>; people?: Person[] } = {},
): PreviewFixture {
  return {
    contacts: [
      {
        providerContactId: "people/mara",
        displayName: "Mara Chen",
        emails: [MARA_EMAIL],
        ...overrides.contact,
      },
    ],
    people: overrides.people ?? [personFixture({ id: "person-mara", displayName: "Mara Chen" })],
    contactMethods: [maraEmailMethodSeed()],
  };
}

/** The same Mara Chen row after the provider grew a phone the owner never saw. */
export function driftedMaraContacts(): GoogleContactsPreviewContact[] {
  return [
    {
      providerContactId: "people/mara",
      displayName: "Mara Chen",
      emails: [MARA_EMAIL],
      phones: ["+1 (312) 555-9999"],
    },
  ];
}
