import type {
  ContactImportFuzzyMatch,
  ContactImportFuzzyMatcher,
  ContactImportPreviewAdapter,
  GoogleContactsPreviewContact,
} from "./types";

export const DEFAULT_CONTACT_IMPORT_PREVIEW_FIXTURES: GoogleContactsPreviewContact[] = [
  {
    providerContactId: "people/c1001",
    displayName: "Mara Chen",
    emails: ["Mara.Chen@example.com"],
    phones: ["+1 (312) 555-0101"],
    birthday: "--04-18",
  },
  {
    providerContactId: "people/c1002",
    displayName: "Ari Patel",
    emails: ["ari@example.com"],
    birthday: "--09-03",
  },
  {
    providerContactId: "people/c1003",
    displayName: "Jordan Lee",
    emails: ["jordan.lee@example.com"],
  },
  {
    providerContactId: "people/c1004",
    displayName: "Printer Support",
    phones: ["555-0100"],
  },
  {
    providerContactId: "people/c1005",
    displayName: "Neighborhood Bakery",
  },
];

export function createFakeContactImportPreviewAdapter(
  contacts: readonly GoogleContactsPreviewContact[] = DEFAULT_CONTACT_IMPORT_PREVIEW_FIXTURES,
): ContactImportPreviewAdapter {
  return {
    async fetchContacts() {
      return contacts.map((contact) => ({
        ...contact,
        emails: contact.emails ? [...contact.emails] : undefined,
        phones: contact.phones ? [...contact.phones] : undefined,
      }));
    },
  };
}

export function createFakeContactImportFuzzyMatcher(
  matchesByProviderContactId: Record<string, ContactImportFuzzyMatch[]> = {},
): ContactImportFuzzyMatcher {
  return {
    async rankPossibleMatches({ contact, people }) {
      const configured = matchesByProviderContactId[contact.providerContactId];
      if (configured) {
        return configured;
      }

      const normalizedContactName = contact.displayName.trim().toLowerCase();
      if (!normalizedContactName) {
        return [];
      }

      return people
        .map((person) => {
          const normalizedPersonName = person.displayName.trim().toLowerCase();
          const similar =
            normalizedPersonName.includes(normalizedContactName) ||
            normalizedContactName.includes(normalizedPersonName) ||
            initials(normalizedPersonName) === initials(normalizedContactName);
          if (!similar) {
            return null;
          }
          return {
            personId: person.id,
            displayName: person.displayName,
            confidence: normalizedPersonName === normalizedContactName ? "high" : "medium",
            reason: "Similar display name",
          } satisfies ContactImportFuzzyMatch;
        })
        .filter((match): match is ContactImportFuzzyMatch => match !== null);
    },
  };
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("");
}
