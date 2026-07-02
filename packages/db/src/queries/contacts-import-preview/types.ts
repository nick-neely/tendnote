import type { Person } from "@tendnote/domain";
import type {
  ContactMethodDuplicateLookupInput,
  ContactMethodDuplicateMatch,
} from "../contact-methods/types";
import type { ProviderConnectionRef } from "../provider-connections/types";

export type GoogleContactsPreviewContact = {
  providerContactId: string;
  displayName: string;
  emails?: string[];
  phones?: string[];
  birthday?: string | null;
};

export type ContactImportPreviewAdapter = {
  fetchContacts: (input: { ownerUserId: string }) => Promise<GoogleContactsPreviewContact[]>;
};

export type ContactImportPreviewDeps = {
  adapter: ContactImportPreviewAdapter;
  isProviderCapabilityConnected: (ref: ProviderConnectionRef) => Promise<boolean>;
  searchPeople: (input: {
    ownerUserId: string;
    query?: string;
    limit: number;
  }) => Promise<Person[]>;
  findOwnerContactMethodDuplicates: (
    input: ContactMethodDuplicateLookupInput,
  ) => Promise<ContactMethodDuplicateMatch[]>;
};

export type ContactImportCandidatePriority =
  | "existing_person_match"
  | "birthday"
  | "useful_email"
  | "lower_priority";

export type ContactImportPreviewCandidate = {
  id: string;
  displayName: string;
  providerContactId: string;
  emails: string[];
  phones: string[];
  birthday: string | null;
  priority: ContactImportCandidatePriority;
  score: number;
  reasons: string[];
  matchedPerson?: Pick<Person, "id" | "displayName"> | null;
};

export type ContactImportPreviewSession = {
  id: string;
  connected: boolean;
  mode: "prioritized" | "search";
  query: string;
  fetchedCount: number;
  shownCount: number;
  hiddenCount: number;
  candidates: ContactImportPreviewCandidate[];
};
