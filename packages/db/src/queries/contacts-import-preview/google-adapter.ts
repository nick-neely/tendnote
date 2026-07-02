import type { ContactImportPreviewAdapter, GoogleContactsPreviewContact } from "./types";

const GOOGLE_PEOPLE_API_BASE = "https://people.googleapis.com";
const CONTACT_PERSON_FIELDS = "names,emailAddresses,phoneNumbers,birthdays";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type GoogleContactsAdapterOptions = {
  getAccessToken: (input: { ownerUserId: string }) => Promise<string>;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  pageSize?: number;
};

type RawGooglePerson = {
  resourceName?: string;
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  birthdays?: Array<{ date?: { month?: number; day?: number } }>;
};

type RawGoogleConnectionsPage = {
  connections?: RawGooglePerson[];
  nextPageToken?: string;
};

export function createGoogleContactsAdapter(
  options: GoogleContactsAdapterOptions,
): ContactImportPreviewAdapter {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const baseUrl = options.baseUrl ?? GOOGLE_PEOPLE_API_BASE;
  const pageSize = options.pageSize ?? 100;

  return {
    async fetchContacts(input) {
      const token = await options.getAccessToken({ ownerUserId: input.ownerUserId });
      const people: RawGooglePerson[] = [];
      let pageToken: string | null = null;

      do {
        const params = new URLSearchParams({
          personFields: CONTACT_PERSON_FIELDS,
          sources: "READ_SOURCE_TYPE_CONTACT",
          sortOrder: "LAST_MODIFIED_DESCENDING",
          pageSize: String(pageSize),
        });
        if (pageToken) {
          params.set("pageToken", pageToken);
        }
        const response = await fetchImpl(
          `${baseUrl}/v1/people/me/connections?${params.toString()}`,
          {
            headers: { authorization: `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          throw new Error(`Google Contacts preview failed with status ${response.status}.`);
        }

        const body = (await response.json()) as RawGoogleConnectionsPage;
        people.push(...(Array.isArray(body.connections) ? body.connections : []));
        pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : null;
      } while (pageToken);

      return people
        .map(minimizePerson)
        .filter((contact): contact is GoogleContactsPreviewContact => contact !== null);
    },
  };
}

function minimizePerson(person: RawGooglePerson): GoogleContactsPreviewContact | null {
  if (!person.resourceName) {
    return null;
  }
  const emails = uniqueValues(person.emailAddresses?.map((email) => email.value));
  const phones = uniqueValues(person.phoneNumbers?.map((phone) => phone.value));
  const displayName = person.names?.find((name) => name.displayName)?.displayName?.trim();
  const fallbackName = emails[0] ?? phones[0];

  if (!displayName && !fallbackName) {
    return null;
  }

  return {
    providerContactId: person.resourceName,
    displayName: displayName ?? fallbackName ?? "Unnamed contact",
    emails,
    phones,
    birthday: firstBirthday(person.birthdays),
  };
}

function firstBirthday(birthdays: RawGooglePerson["birthdays"]): string | null {
  const birthday = birthdays?.find((item) => item.date?.month && item.date.day);
  const month = birthday?.date?.month;
  const day = birthday?.date?.day;
  if (!month || !day) {
    return null;
  }
  return `--${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function uniqueValues(values: Array<string | undefined> | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value?.trim()).filter(Boolean) as string[])];
}
