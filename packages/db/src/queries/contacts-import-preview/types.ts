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

/** A person the owner may attach this candidate to during manual resolution. */
export type ContactImportCandidateTarget = {
  personId: string;
  label: string;
  kind: "matched" | "advisory";
};

/**
 * The authoritative set of manual-resolution decisions the preview allows for
 * one candidate. The review UI presents exactly these choices; it never
 * re-derives eligibility, so the workflow and the UI cannot drift. Whether a row
 * is a one-click safe add is carried by `safeBulkEligible`, not repeated here.
 */
export type ContactImportCandidateDecisions = {
  /** People this candidate may be attached to, deduped and labeled. */
  targets: ContactImportCandidateTarget[];
  /** The owner must actively choose among `targets` before applying. */
  targetChoiceRequired: boolean;
  /** Creating a brand-new person is an allowed resolution. */
  canCreatePerson: boolean;
  /** A birthday conflict must be resolved (keep existing vs. use the provider value). */
  birthdayChoiceRequired: boolean;
  /** At least one safe resolution exists; false means the row can only be skipped. */
  resolvable: boolean;
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
  /** Authoritative allowed decisions for this candidate; the UI renders only these. */
  decisions: ContactImportCandidateDecisions;
  /**
   * Stable digest of the decision-relevant candidate state (identity, written
   * fields, match, and allowed decisions). Confirmation carries it back and apply
   * refuses (reporting the row as stale) when provider data drifts in between.
   */
  fingerprint: string;
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

/** Why a requested candidate was not imported, so the UI can reconcile honestly. */
export type ContactImportNotImportedReason =
  | "stale"
  | "unknown"
  | "ineligible"
  | "missing_target"
  | "skipped";

export type ContactImportNotImportedCandidate = {
  candidateId: string;
  reason: ContactImportNotImportedReason;
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
  /** Requested candidates that were not imported, each with a reconciliation reason. */
  notImported: ContactImportNotImportedCandidate[];
  undoAvailable: false;
};

/**
 * One owner confirmation for a single candidate. The fingerprint is required:
 * apply always checks it, so every processed candidate is drift-guarded and the
 * guarantee is owned by the workflow rather than volunteered by callers.
 */
export type ContactImportCandidateConfirmation = {
  candidateId: string;
  /** The candidate fingerprint the owner reviewed; apply refuses on a mismatch. */
  expectedFingerprint: string;
  action?: "apply" | "skip";
  targetPersonId?: string | null;
  createPerson?: boolean;
  birthdayChoice?: "provider" | "existing" | "skip";
};
