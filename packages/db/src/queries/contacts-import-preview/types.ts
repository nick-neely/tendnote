import type { Person } from "@tendnote/domain";
import type {
  ContactMethodDuplicateLookupInput,
  ContactMethodDuplicateMatch,
  CreateContactMethodInput,
} from "../contact-methods/types";
import type { CreatePersonMutationInput, UpdatePersonMutationInput } from "../people/types";
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
  fuzzyMatcher?: ContactImportFuzzyMatcher;
  isProviderCapabilityConnected: (ref: ProviderConnectionRef) => Promise<boolean>;
  searchPeople: (input: {
    ownerUserId: string;
    query?: string;
    limit: number;
  }) => Promise<Person[]>;
  getPerson: (input: { ownerUserId: string; personId: string }) => Promise<Person | null>;
  findOwnerContactMethodDuplicates: (
    input: ContactMethodDuplicateLookupInput,
  ) => Promise<ContactMethodDuplicateMatch[]>;
};

export type ContactImportFuzzyMatch = {
  personId: string;
  displayName: string;
  confidence: "medium" | "high";
  reason: string;
};

export type ContactImportFuzzyMatcher = {
  rankPossibleMatches: (input: {
    ownerUserId: string;
    contact: GoogleContactsPreviewContact;
    people: Person[];
  }) => Promise<ContactImportFuzzyMatch[]>;
};

export type ContactImportCandidatePriority =
  | "existing_person_match"
  | "birthday"
  | "useful_email"
  | "lower_priority";

export type ContactImportCandidateReviewState =
  | "safe_recommendation"
  | "conflict"
  | "ambiguous_duplicate"
  | "advisory_match"
  | "individual_review"
  | "weak_match";

export type ContactImportCandidateMatchSignal = {
  type: "email" | "phone";
  value: string;
  confidence: "strong";
  matchedPersonId: string;
};

export type ContactImportCandidateConflict = {
  type:
    | "birthday"
    | "duplicate_contact_method"
    | "display_name_review"
    | "ambiguous_contact_method";
  message: string;
};

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
  reviewState: ContactImportCandidateReviewState;
  safeBulkEligible: boolean;
  matchSignals: ContactImportCandidateMatchSignal[];
  advisoryMatches: ContactImportFuzzyMatch[];
  conflicts: ContactImportCandidateConflict[];
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
  errorMessage?: string;
  candidates: ContactImportPreviewCandidate[];
};

export type ContactImportProviderReferenceInput = {
  ownerUserId: string;
  personId: string;
  providerKey: "google";
  providerContactId: string;
};

export type ContactImportAuditEntry = {
  ownerUserId: string;
  action: "contact_import.candidate_confirmed";
  entityType: "contact_import_candidate";
  entityId: string;
  metadataJson: Record<string, unknown>;
};

export type ContactImportApplyDeps = ContactImportPreviewDeps & {
  createPerson: (input: CreatePersonMutationInput) => Promise<Person>;
  updatePerson: (input: UpdatePersonMutationInput) => Promise<Person | null>;
  createContactMethod: (input: CreateContactMethodInput) => Promise<ContactMethodDuplicateMatch>;
  createProviderReference: (input: ContactImportProviderReferenceInput) => Promise<void>;
  createAuditLogEntry: (entry: ContactImportAuditEntry) => Promise<void>;
};

export type ContactImportApplyResult = {
  importedCount: number;
  createdPeople: number;
  updatedPeople: number;
  addedContactMethods: number;
  addedBirthdays: number;
  errorMessage?: string;
  candidates: Array<{
    candidateId: string;
    providerContactId: string;
    personId: string;
    displayName: string;
    createdPerson: boolean;
    addedEmails: string[];
    addedPhones: string[];
    addedBirthday: string | null;
    skipped: string[];
  }>;
  undoAvailable: false;
};

export type ContactImportCandidateResolution = {
  candidateId: string;
  action: "apply" | "skip";
  targetPersonId?: string | null;
  createPerson?: boolean;
  birthdayChoice?: "provider" | "existing" | "skip";
};
