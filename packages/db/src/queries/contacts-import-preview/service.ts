import { createHash, randomUUID } from "node:crypto";
import {
  birthdaySchema,
  normalizeEmailContactValue,
  normalizePhoneContactValue,
} from "@tendnote/domain";
import type { ContactMethodDuplicateMatch } from "../contact-methods/types";
import type {
  ContactImportCandidateConflict,
  ContactImportCandidateMatchSignal,
  ContactImportPreviewCandidate,
  ContactImportPreviewDeps,
  ContactImportPreviewSession,
  GoogleContactsPreviewContact,
} from "./types";

const DEFAULT_PREVIEW_LIMIT = 3;

export async function createContactImportPreviewSession(
  input: { ownerUserId: string; query?: string; limit?: number },
  deps: ContactImportPreviewDeps,
): Promise<ContactImportPreviewSession> {
  const ref = {
    ownerUserId: input.ownerUserId,
    providerKey: "google",
    capabilityKey: "contacts",
  };
  const connected = await deps.isProviderCapabilityConnected(ref);
  const query = input.query?.trim() ?? "";
  const mode = query ? "search" : "prioritized";
  const limit = input.limit ?? DEFAULT_PREVIEW_LIMIT;

  if (!connected) {
    return {
      id: randomUUID(),
      connected: false,
      mode,
      query,
      fetchedCount: 0,
      shownCount: 0,
      hiddenCount: 0,
      candidates: [],
    };
  }

  const contacts = await deps.adapter.fetchContacts({ ownerUserId: input.ownerUserId });
  const people = await deps.searchPeople({ ownerUserId: input.ownerUserId, limit: 50 });
  const normalizedMethods = contacts.flatMap((contact) => normalizedContactMethods(contact));
  const duplicateMatches = normalizedMethods.length
    ? await deps.findOwnerContactMethodDuplicates({
        ownerUserId: input.ownerUserId,
        methods: normalizedMethods,
      })
    : [];

  const candidates = (
    await Promise.all(
      contacts.map((contact) =>
        buildCandidate({
          contact,
          ownerUserId: input.ownerUserId,
          people,
          duplicateMatches,
          deps,
        }),
      ),
    )
  )
    .filter((candidate) => (query ? candidateMatchesSearch(candidate, query) : true))
    .sort(compareCandidates);

  const shown =
    mode === "search"
      ? candidates
      : [
          ...candidates.filter((candidate) => candidate.safeBulkEligible).slice(0, limit),
          ...candidates.filter((candidate) => !candidate.safeBulkEligible).slice(0, limit),
        ];

  return {
    id: randomUUID(),
    connected: true,
    mode,
    query,
    fetchedCount: contacts.length,
    shownCount: shown.length,
    hiddenCount: mode === "search" ? 0 : Math.max(0, candidates.length - shown.length),
    candidates: shown,
  };
}

async function buildCandidate(input: {
  contact: GoogleContactsPreviewContact;
  ownerUserId: string;
  people: Awaited<ReturnType<ContactImportPreviewDeps["searchPeople"]>>;
  duplicateMatches: ContactMethodDuplicateMatch[];
  deps: ContactImportPreviewDeps;
}): Promise<ContactImportPreviewCandidate> {
  const { contact, ownerUserId, people, duplicateMatches, deps } = input;
  const emails = (contact.emails ?? []).map((email) => email.trim()).filter(Boolean);
  const phones = (contact.phones ?? []).map((phone) => phone.trim()).filter(Boolean);
  const normalizedEmails = emails.map(normalizeEmailContactValue);
  const normalizedPhones = phones
    .map((phone) => normalizePhoneContactValue(phone).normalizedValue)
    .filter((value): value is string => value !== null);
  const hasAmbiguousPhone = phones.length > normalizedPhones.length;
  const matches = duplicateMatches.filter(
    (duplicate) =>
      (duplicate.type === "email" && normalizedEmails.includes(duplicate.normalizedValue ?? "")) ||
      (duplicate.type === "phone" && normalizedPhones.includes(duplicate.normalizedValue ?? "")),
  );
  const matchedPersonIds = [...new Set(matches.map((match) => match.personId))];
  const hasExistingPersonMatch = matchedPersonIds.length > 0;
  const ambiguousDuplicate = matchedPersonIds.length > 1;
  const matchedPersonId = matchedPersonIds.length === 1 ? matchedPersonIds[0] : null;
  const loadedMatchedPerson = matchedPersonId
    ? await deps.getPerson({ ownerUserId, personId: matchedPersonId })
    : null;
  const matchedPerson =
    loadedMatchedPerson ??
    (matchedPersonId ? (people.find((person) => person.id === matchedPersonId) ?? null) : null);
  const birthday = normalizeBirthday(contact.birthday);
  const reasons: string[] = [];
  const conflicts: ContactImportCandidateConflict[] = [];
  const matchSignals = buildMatchSignals(matches, normalizedEmails, normalizedPhones);
  let score = 0;

  if (hasExistingPersonMatch) {
    score += 100;
    reasons.push(
      matchedPerson
        ? `Matches ${matchedPerson.displayName} by saved contact method`
        : "Matches an existing Tendnote person by saved contact method",
    );
  }
  if (ambiguousDuplicate) {
    score -= 25;
    conflicts.push({
      type: "duplicate_contact_method",
      message: "This contact method is already attached to more than one Tendnote person.",
    });
  }
  if (birthday && matchedPerson?.birthday && matchedPerson.birthday !== birthday) {
    score -= 30;
    conflicts.push({
      type: "birthday",
      message: `Tendnote already has birthday ${matchedPerson.birthday}.`,
    });
  }
  if (
    matchedPerson &&
    matchedPerson.displayName.trim().toLowerCase() !== contact.displayName.trim().toLowerCase()
  ) {
    conflicts.push({
      type: "display_name_review",
      message: `Review name difference from ${matchedPerson.displayName}.`,
    });
  }
  if (hasAmbiguousPhone) {
    conflicts.push({
      type: "ambiguous_contact_method",
      message: "Review phone number before using it for matching or import.",
    });
  }
  if (birthday) {
    score += 30;
    reasons.push("Includes a birthday");
  }
  if (emails.length > 0) {
    score += 20;
    reasons.push("Includes an email address");
  }
  if (normalizedPhones.length > 0) {
    score += 10;
    reasons.push("Includes a confidently normalized phone");
  }
  if (reasons.length === 0) {
    reasons.push("Lower-signal contact available through search");
  }
  const hasStrongRecommendation = matchSignals.length > 0;
  const reviewState = ambiguousDuplicate
    ? "ambiguous_duplicate"
    : conflicts.some((conflict) => conflict.type === "birthday")
      ? "conflict"
      : conflicts.length > 0
        ? "individual_review"
        : hasStrongRecommendation
          ? "safe_recommendation"
          : emails.length > 0 || birthday || normalizedPhones.length > 0
            ? "individual_review"
            : "weak_match";
  const safeBulkEligible = reviewState === "safe_recommendation";

  return {
    id: stableCandidateId(contact.providerContactId),
    providerContactId: contact.providerContactId,
    displayName: contact.displayName,
    emails,
    phones,
    birthday,
    priority: hasExistingPersonMatch
      ? "existing_person_match"
      : birthday
        ? "birthday"
        : emails.length > 0
          ? "useful_email"
          : "lower_priority",
    score,
    reasons,
    reviewState,
    safeBulkEligible,
    matchSignals,
    conflicts,
    matchedPerson: matchedPerson
      ? { id: matchedPerson.id, displayName: matchedPerson.displayName }
      : null,
  };
}

function buildMatchSignals(
  matches: ContactMethodDuplicateMatch[],
  normalizedEmails: string[],
  normalizedPhones: string[],
): ContactImportCandidateMatchSignal[] {
  return matches.flatMap<ContactImportCandidateMatchSignal>((match) => {
    if (match.type === "email" && normalizedEmails.includes(match.normalizedValue ?? "")) {
      return [
        {
          type: "email" as const,
          value: match.normalizedValue ?? match.value,
          confidence: "strong" as const,
          matchedPersonId: match.personId,
        },
      ];
    }
    if (match.type === "phone" && normalizedPhones.includes(match.normalizedValue ?? "")) {
      return [
        {
          type: "phone" as const,
          value: match.normalizedValue ?? match.value,
          confidence: "strong" as const,
          matchedPersonId: match.personId,
        },
      ];
    }
    return [];
  });
}

function normalizedContactMethods(contact: GoogleContactsPreviewContact) {
  const emails = (contact.emails ?? []).map((email) => ({
    type: "email" as const,
    value: email,
    normalizedValue: normalizeEmailContactValue(email),
  }));
  const phones = (contact.phones ?? []).map((phone) => ({
    type: "phone" as const,
    value: phone,
    normalizedValue: normalizePhoneContactValue(phone).normalizedValue,
  }));
  return [...emails, ...phones];
}

function normalizeBirthday(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return birthdaySchema.safeParse(value).success ? value : null;
}

function candidateMatchesSearch(candidate: ContactImportPreviewCandidate, query: string): boolean {
  const normalizedQuery = query.toLowerCase();
  return [candidate.displayName, candidate.birthday, ...candidate.emails, ...candidate.phones].some(
    (value) => value?.toLowerCase().includes(normalizedQuery),
  );
}

function compareCandidates(
  left: ContactImportPreviewCandidate,
  right: ContactImportPreviewCandidate,
): number {
  const byScore = right.score - left.score;
  if (byScore !== 0) {
    return byScore;
  }
  return left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
}

function stableCandidateId(providerContactId: string): string {
  return createHash("sha256").update(providerContactId).digest("hex").slice(0, 16);
}
