import { createHash } from "node:crypto";
import type { Person } from "@tendnote/domain";
import {
  birthdaySchema,
  normalizeEmailContactValue,
  normalizePhoneContactValue,
} from "@tendnote/domain";
import type { ContactMethodDuplicateMatch } from "../contact-methods/types";
import { buildCandidateDecisions, candidateFingerprint } from "./decisions";
import type {
  ContactImportCandidateConflict,
  ContactImportCandidateMatchSignal,
  ContactImportCandidatePriority,
  ContactImportCandidateReviewState,
  ContactImportFuzzyMatch,
  ContactImportPreviewCandidate,
  ContactImportPreviewDeps,
  GoogleContactsPreviewContact,
} from "./types";

/**
 * Candidate assembly: turning one raw provider contact into the reviewed
 * candidate the owner sees. Kept apart from session assembly and apply so the
 * "what is this contact, who does it match, and how risky is it" rules have one
 * home. Every step below the entry point is a small named seam: field
 * normalization, match resolution, conflict detection, scoring, and review
 * state are each decidable on their own, and only match resolution touches IO.
 */

type OwnerPeople = Awaited<ReturnType<ContactImportPreviewDeps["searchPeople"]>>;

/** The provider contact's fields, trimmed and normalized once for every later step. */
type CandidateFields = {
  emails: string[];
  phones: string[];
  normalizedEmails: string[];
  normalizedPhones: string[];
  /** At least one phone could not be confidently normalized, so it must be reviewed. */
  hasAmbiguousPhone: boolean;
  birthday: string | null;
};

/** Who this contact resolves to, from deterministic signals and advisory ranking. */
type CandidateMatch = {
  matchedPerson: Person | null;
  hasExistingPersonMatch: boolean;
  /** The same contact method is attached to more than one person. */
  ambiguousDuplicate: boolean;
  matchSignals: ContactImportCandidateMatchSignal[];
  advisoryMatches: ContactImportFuzzyMatch[];
};

export async function buildCandidate(input: {
  contact: GoogleContactsPreviewContact;
  ownerUserId: string;
  people: OwnerPeople;
  duplicateMatches: ContactMethodDuplicateMatch[];
  deps: ContactImportPreviewDeps;
}): Promise<ContactImportPreviewCandidate> {
  const { contact } = input;
  const fields = normalizeContactFields(contact);
  const match = await resolveCandidateMatch({ ...input, fields });
  const conflicts = detectConflicts({ contact, fields, match });
  const { score, reasons } = scoreCandidate({ fields, match, conflicts });
  const reviewState = resolveReviewState({ fields, match, conflicts });
  const safeBulkEligible = reviewState === "safe_recommendation";
  const matchedPerson = match.matchedPerson
    ? { id: match.matchedPerson.id, displayName: match.matchedPerson.displayName }
    : null;
  const decisions = buildCandidateDecisions({
    reviewState,
    safeBulkEligible,
    matchedPerson,
    advisoryMatches: match.advisoryMatches,
    conflicts,
  });

  return {
    id: stableCandidateId(contact.providerContactId),
    providerContactId: contact.providerContactId,
    displayName: contact.displayName,
    emails: fields.emails,
    phones: fields.phones,
    birthday: fields.birthday,
    priority: candidatePriority(fields, match),
    score,
    reasons,
    reviewState,
    safeBulkEligible,
    decisions,
    fingerprint: candidateFingerprint({
      providerContactId: contact.providerContactId,
      displayName: contact.displayName,
      emails: fields.emails,
      phones: fields.phones,
      birthday: fields.birthday,
      reviewState,
      safeBulkEligible,
      matchedPersonId: matchedPerson?.id ?? null,
      decisions,
    }),
    matchSignals: match.matchSignals,
    advisoryMatches: match.advisoryMatches,
    conflicts,
    matchedPerson,
  };
}

function normalizeContactFields(contact: GoogleContactsPreviewContact): CandidateFields {
  const emails = (contact.emails ?? []).map((email) => email.trim()).filter(Boolean);
  const phones = (contact.phones ?? []).map((phone) => phone.trim()).filter(Boolean);
  const normalizedPhones = phones
    .map((phone) => normalizePhoneContactValue(phone).normalizedValue)
    .filter((value): value is string => value !== null);
  return {
    emails,
    phones,
    normalizedEmails: emails.map(normalizeEmailContactValue),
    normalizedPhones,
    hasAmbiguousPhone: phones.length > normalizedPhones.length,
    birthday: normalizeBirthday(contact.birthday),
  };
}

/**
 * Deterministic contact-method matches decide identity; fuzzy ranking is only
 * consulted when nothing deterministic matched, and never auto-links.
 */
async function resolveCandidateMatch(input: {
  contact: GoogleContactsPreviewContact;
  ownerUserId: string;
  people: OwnerPeople;
  duplicateMatches: ContactMethodDuplicateMatch[];
  deps: ContactImportPreviewDeps;
  fields: CandidateFields;
}): Promise<CandidateMatch> {
  const { contact, ownerUserId, people, deps, fields } = input;
  const matches = input.duplicateMatches.filter((duplicate) =>
    normalizedValuesFor(fields, duplicate.type).includes(duplicate.normalizedValue ?? ""),
  );
  const matchedPersonIds = [...new Set(matches.map((match) => match.personId))];
  const matchedPersonId = matchedPersonIds.length === 1 ? matchedPersonIds[0] : null;
  const matchedPerson = matchedPersonId
    ? await loadMatchedPerson({ ownerUserId, personId: matchedPersonId, people, deps })
    : null;
  const hasExistingPersonMatch = matchedPersonIds.length > 0;

  return {
    matchedPerson,
    hasExistingPersonMatch,
    ambiguousDuplicate: matchedPersonIds.length > 1,
    matchSignals: buildMatchSignals(matches, fields),
    advisoryMatches: hasExistingPersonMatch
      ? []
      : sanitizeAdvisoryMatches(
          await (deps.fuzzyMatcher?.rankPossibleMatches({ ownerUserId, contact, people }) ?? []),
          people,
        ),
  };
}

function normalizedValuesFor(fields: CandidateFields, type: "email" | "phone"): string[] {
  return type === "email" ? fields.normalizedEmails : fields.normalizedPhones;
}

/** Prefer the authoritative owner-scoped read; fall back to the already-loaded page. */
async function loadMatchedPerson(input: {
  ownerUserId: string;
  personId: string;
  people: OwnerPeople;
  deps: ContactImportPreviewDeps;
}): Promise<Person | null> {
  const loaded = await input.deps.getPerson({
    ownerUserId: input.ownerUserId,
    personId: input.personId,
  });
  return loaded ?? input.people.find((person) => person.id === input.personId) ?? null;
}

function detectConflicts(input: {
  contact: GoogleContactsPreviewContact;
  fields: CandidateFields;
  match: CandidateMatch;
}): ContactImportCandidateConflict[] {
  const { contact, fields, match } = input;
  const matchedPerson = match.matchedPerson;
  const conflicts: ContactImportCandidateConflict[] = [];

  if (match.ambiguousDuplicate) {
    conflicts.push({
      type: "duplicate_contact_method",
      message: "This contact method is already attached to more than one Tendnote person.",
    });
  }
  if (fields.birthday && matchedPerson?.birthday && matchedPerson.birthday !== fields.birthday) {
    conflicts.push({
      type: "birthday",
      message: `Tendnote already has birthday ${matchedPerson.birthday}.`,
    });
  }
  if (matchedPerson && !sameDisplayName(matchedPerson.displayName, contact.displayName)) {
    conflicts.push({
      type: "display_name_review",
      message: `Review name difference from ${matchedPerson.displayName}.`,
    });
  }
  if (fields.hasAmbiguousPhone) {
    conflicts.push({
      type: "ambiguous_contact_method",
      message: "Review phone number before using it for matching or import.",
    });
  }
  return conflicts;
}

function sameDisplayName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Ordering signal for the prioritized preview, plus the owner-readable reasons
 * behind it. Conflicts subtract from the score but never add a reason: a reason
 * explains why a row is worth attention, a conflict explains why it is risky.
 */
function scoreCandidate(input: {
  fields: CandidateFields;
  match: CandidateMatch;
  conflicts: ContactImportCandidateConflict[];
}): { score: number; reasons: string[] } {
  const { fields, match, conflicts } = input;
  const reasons: string[] = [];
  let score = 0;

  if (match.hasExistingPersonMatch) {
    score += 100;
    reasons.push(
      match.matchedPerson
        ? `Matches ${match.matchedPerson.displayName} by saved contact method`
        : "Matches an existing Tendnote person by saved contact method",
    );
  }
  const [advisory] = match.advisoryMatches;
  if (advisory) {
    score += advisory.confidence === "high" ? 45 : 25;
    reasons.push(`Possible match: ${advisory.displayName}`);
  }
  if (hasConflict(conflicts, "duplicate_contact_method")) {
    score -= 25;
  }
  if (hasConflict(conflicts, "birthday")) {
    score -= 30;
  }
  if (fields.birthday) {
    score += 30;
    reasons.push("Includes a birthday");
  }
  if (fields.emails.length > 0) {
    score += 20;
    reasons.push("Includes an email address");
  }
  if (fields.normalizedPhones.length > 0) {
    score += 10;
    reasons.push("Includes a confidently normalized phone");
  }
  if (reasons.length === 0) {
    reasons.push("Lower-signal contact available through search");
  }
  return { score, reasons };
}

/**
 * The single ladder from evidence to review state, most-blocking first. Only
 * `safe_recommendation` is bulk-eligible, so every rung above it is a hard stop
 * on one-click import.
 */
function resolveReviewState(input: {
  fields: CandidateFields;
  match: CandidateMatch;
  conflicts: ContactImportCandidateConflict[];
}): ContactImportCandidateReviewState {
  const { fields, match, conflicts } = input;
  if (match.ambiguousDuplicate) {
    return "ambiguous_duplicate";
  }
  if (hasConflict(conflicts, "birthday")) {
    return "conflict";
  }
  if (conflicts.length > 0) {
    return "individual_review";
  }
  if (match.matchSignals.length > 0) {
    return "safe_recommendation";
  }
  if (match.advisoryMatches.length > 0) {
    return "advisory_match";
  }
  if (fields.emails.length > 0 || fields.birthday || fields.normalizedPhones.length > 0) {
    return "individual_review";
  }
  return "weak_match";
}

function candidatePriority(
  fields: CandidateFields,
  match: CandidateMatch,
): ContactImportCandidatePriority {
  if (match.hasExistingPersonMatch) {
    return "existing_person_match";
  }
  if (fields.birthday) {
    return "birthday";
  }
  if (fields.emails.length > 0) {
    return "useful_email";
  }
  return "lower_priority";
}

function hasConflict(
  conflicts: ContactImportCandidateConflict[],
  type: ContactImportCandidateConflict["type"],
): boolean {
  return conflicts.some((conflict) => conflict.type === type);
}

/** Fuzzy output is untrusted: drop unknown people and re-label from owner data. */
function sanitizeAdvisoryMatches(
  matches: ContactImportFuzzyMatch[],
  people: OwnerPeople,
): ContactImportFuzzyMatch[] {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const seen = new Set<string>();
  return matches.flatMap((match) => {
    const person = peopleById.get(match.personId);
    if (!person || seen.has(person.id)) {
      return [];
    }
    seen.add(person.id);
    return [{ ...match, displayName: person.displayName }];
  });
}

function buildMatchSignals(
  matches: ContactMethodDuplicateMatch[],
  fields: CandidateFields,
): ContactImportCandidateMatchSignal[] {
  return matches.flatMap<ContactImportCandidateMatchSignal>((match) => {
    if (!normalizedValuesFor(fields, match.type).includes(match.normalizedValue ?? "")) {
      return [];
    }
    return [
      {
        type: match.type,
        value: match.normalizedValue ?? match.value,
        confidence: "strong" as const,
        matchedPersonId: match.personId,
      },
    ];
  });
}

/** Every provider contact method, shaped for the owner-wide duplicate lookup. */
export function normalizedContactMethods(contact: GoogleContactsPreviewContact) {
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

function stableCandidateId(providerContactId: string): string {
  return createHash("sha256").update(providerContactId).digest("hex").slice(0, 16);
}
