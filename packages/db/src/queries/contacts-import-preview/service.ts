import { createHash, randomUUID } from "node:crypto";
import {
  birthdaySchema,
  normalizeEmailContactValue,
  normalizePhoneContactValue,
} from "@tendnote/domain";
import type { ContactMethodDuplicateMatch } from "../contact-methods/types";
import { buildCandidateDecisions, candidateFingerprint } from "./decisions";
import type {
  ContactImportApplyDeps,
  ContactImportApplyResult,
  ContactImportCandidateConfirmation,
  ContactImportCandidateConflict,
  ContactImportCandidateMatchSignal,
  ContactImportFuzzyMatch,
  ContactImportNotImportedCandidate,
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

  let contacts: GoogleContactsPreviewContact[];
  try {
    contacts = await deps.adapter.fetchContacts({ ownerUserId: input.ownerUserId });
  } catch (error) {
    return {
      id: randomUUID(),
      connected: true,
      mode,
      query,
      fetchedCount: 0,
      shownCount: 0,
      hiddenCount: 0,
      errorMessage:
        error instanceof Error
          ? error.message
          : "Google Contacts preview is temporarily unavailable.",
      candidates: [],
    };
  }
  const people = await deps.searchPeople({ ownerUserId: input.ownerUserId, limit: 200 });
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

/**
 * The Contact Import Preview workflow's owner-scoped apply seam.
 *
 * Deletion test: removing this module would scatter candidate identity,
 * confirmation eligibility, target and create-person policy, birthday
 * reconciliation, provider-drift protection, ephemeral-row handling, owner-wide
 * deduplication, minimized provenance, and audit behavior across the server
 * action and the review UI. Those policies belong together here, behind one
 * interface, with provider and persistence adapters kept internal.
 *
 * Apply rebuilds the preview from a fresh provider fetch so unconfirmed rows
 * stay ephemeral and every write re-derives from authoritative candidate state.
 * Every confirmation must carry the fingerprint the owner reviewed; apply always
 * checks it, so a drifted provider response is reported as stale (never silently
 * reinterpreted) — the guarantee is owned here, not volunteered by callers.
 */
export async function applyContactImportCandidates(
  input: {
    ownerUserId: string;
    mode?: "safe_bulk" | "explicit";
    confirmations: ContactImportCandidateConfirmation[];
  },
  deps: ContactImportApplyDeps,
): Promise<ContactImportApplyResult> {
  const preview = await createContactImportPreviewSession(
    { ownerUserId: input.ownerUserId, limit: 200 },
    deps,
  );
  if (preview.errorMessage) {
    return emptyApplyResult(preview.errorMessage);
  }
  const mode = input.mode ?? "safe_bulk";
  const candidatesById = new Map(preview.candidates.map((candidate) => [candidate.id, candidate]));
  // Dedupe by candidate id so a repeated confirmation in one request cannot
  // trigger a double write; the last confirmation for an id wins.
  const confirmations = new Map(
    input.confirmations.map((confirmation) => [confirmation.candidateId, confirmation]),
  );

  const results: ContactImportApplyResult["candidates"] = [];
  const notImported: ContactImportNotImportedCandidate[] = [];

  for (const [candidateId, confirmation] of confirmations) {
    const candidate = candidatesById.get(candidateId);
    if (!candidate) {
      // Stale or invalid identity: never present in the fresh preview.
      notImported.push({ candidateId, reason: "unknown" });
      continue;
    }

    if (confirmation.expectedFingerprint !== candidate.fingerprint) {
      // Provider data drifted after the owner reviewed it; report it as stale.
      notImported.push({ candidateId, reason: "stale" });
      continue;
    }

    if (confirmation.action === "skip") {
      notImported.push({ candidateId, reason: "skipped" });
      continue;
    }

    const confirmable =
      mode === "safe_bulk"
        ? candidate.safeBulkEligible
        : canExplicitlyConfirm(candidate, confirmation);
    if (!confirmable) {
      notImported.push({ candidateId, reason: "ineligible" });
      continue;
    }

    // A requested target must be one the workflow offered; anything else is a
    // drift between UI and policy and must not attach to an arbitrary person.
    const requestedTargetPersonId = confirmation.targetPersonId ?? null;
    if (
      requestedTargetPersonId &&
      !candidate.decisions.targets.some((target) => target.personId === requestedTargetPersonId)
    ) {
      notImported.push({ candidateId, reason: "missing_target" });
      continue;
    }
    const targetPersonId = requestedTargetPersonId ?? candidate.matchedPerson?.id ?? null;
    const existingPerson = targetPersonId
      ? await deps.getPerson({
          ownerUserId: input.ownerUserId,
          personId: targetPersonId,
        })
      : null;
    if (targetPersonId && !existingPerson) {
      notImported.push({ candidateId, reason: "missing_target" });
      continue;
    }
    const canCreatePerson = Boolean(
      confirmation.createPerson && candidate.decisions.canCreatePerson,
    );
    if (!existingPerson && !canCreatePerson) {
      notImported.push({ candidateId, reason: "ineligible" });
      continue;
    }
    const person =
      existingPerson ??
      (await deps.createPerson({
        ownerUserId: input.ownerUserId,
        displayName: candidate.displayName,
        birthday: confirmation.birthdayChoice === "skip" ? null : candidate.birthday,
        source: "contact_import",
      }));
    const createdPerson = !existingPerson;
    const addedEmails: string[] = [];
    const addedPhones: string[] = [];
    let addedBirthday: string | null = null;
    const skipped: string[] = [];

    if (!createdPerson && candidate.birthday) {
      if (person.birthday) {
        if (person.birthday !== candidate.birthday && confirmation.birthdayChoice === "provider") {
          const updated = await deps.updatePerson({
            ownerUserId: input.ownerUserId,
            personId: person.id,
            birthday: candidate.birthday,
          });
          if (updated) {
            addedBirthday = candidate.birthday;
          }
        } else {
          skipped.push("birthday");
        }
      } else {
        const updated = await deps.updatePerson({
          ownerUserId: input.ownerUserId,
          personId: person.id,
          birthday: candidate.birthday,
        });
        if (updated) {
          addedBirthday = candidate.birthday;
        }
      }
    } else if (createdPerson && candidate.birthday) {
      addedBirthday = candidate.birthday;
    }

    for (const email of candidate.emails) {
      const normalizedValue = normalizeEmailContactValue(email);
      if (
        candidate.matchSignals.some(
          (signal) => signal.type === "email" && signal.value === normalizedValue,
        )
      ) {
        skipped.push(`email:${email}`);
        continue;
      }
      const duplicate = await findWriteTimeDuplicate({
        deps,
        ownerUserId: input.ownerUserId,
        personId: person.id,
        method: { type: "email", value: email, normalizedValue },
      });
      if (duplicate) {
        skipped.push(`email:${email}`);
        continue;
      }
      await deps.createContactMethod({
        ownerUserId: input.ownerUserId,
        personId: person.id,
        type: "email",
        value: normalizedValue,
        displayValue: email,
        normalizedValue,
        source: "contact_import",
      });
      addedEmails.push(email);
    }

    for (const phone of candidate.phones) {
      const normalizedValue = normalizePhoneContactValue(phone).normalizedValue;
      if (!normalizedValue) {
        skipped.push(`phone:${phone}`);
        continue;
      }
      if (
        candidate.matchSignals.some(
          (signal) => signal.type === "phone" && signal.value === normalizedValue,
        )
      ) {
        skipped.push(`phone:${phone}`);
        continue;
      }
      const duplicate = await findWriteTimeDuplicate({
        deps,
        ownerUserId: input.ownerUserId,
        personId: person.id,
        method: { type: "phone", value: phone, normalizedValue },
      });
      if (duplicate) {
        skipped.push(`phone:${phone}`);
        continue;
      }
      await deps.createContactMethod({
        ownerUserId: input.ownerUserId,
        personId: person.id,
        type: "phone",
        value: normalizedValue,
        displayValue: phone,
        normalizedValue,
        source: "contact_import",
      });
      addedPhones.push(phone);
    }

    await deps.createProviderReference({
      ownerUserId: input.ownerUserId,
      personId: person.id,
      providerKey: "google",
      providerContactId: candidate.providerContactId,
    });

    await deps.createAuditLogEntry({
      ownerUserId: input.ownerUserId,
      action: "contact_import.candidate_confirmed",
      entityType: "contact_import_candidate",
      entityId: candidate.id,
      metadataJson: {
        providerKey: "google",
        providerContactId: candidate.providerContactId,
        personId: person.id,
        createdPerson,
        addedEmails,
        addedPhones,
        addedBirthday,
        skipped,
        resolution: {
          action: confirmation.action ?? "apply",
          targetPersonId: confirmation.targetPersonId ?? null,
          createPerson: confirmation.createPerson ?? null,
          birthdayChoice: confirmation.birthdayChoice ?? null,
        },
      },
    });

    results.push({
      candidateId: candidate.id,
      providerContactId: candidate.providerContactId,
      personId: person.id,
      displayName: person.displayName,
      createdPerson,
      addedEmails,
      addedPhones,
      addedBirthday,
      skipped,
    });
  }

  return {
    importedCount: results.length,
    createdPeople: results.filter((result) => result.createdPerson).length,
    updatedPeople: results.filter((result) => !result.createdPerson).length,
    addedContactMethods: results.reduce(
      (count, result) => count + result.addedEmails.length + result.addedPhones.length,
      0,
    ),
    addedBirthdays: results.filter((result) => result.addedBirthday).length,
    candidates: results,
    notImported,
    undoAvailable: false,
  };
}

function emptyApplyResult(errorMessage?: string): ContactImportApplyResult {
  return {
    importedCount: 0,
    createdPeople: 0,
    updatedPeople: 0,
    addedContactMethods: 0,
    addedBirthdays: 0,
    errorMessage,
    candidates: [],
    notImported: [],
    undoAvailable: false,
  };
}

function canExplicitlyConfirm(
  candidate: ContactImportPreviewCandidate,
  confirmation: ContactImportCandidateConfirmation,
): boolean {
  if (candidate.safeBulkEligible) {
    return true;
  }
  if (confirmation.targetPersonId) {
    // Target validity is enforced against the allowed set at apply time.
    return true;
  }
  return Boolean(confirmation.createPerson && candidate.decisions.canCreatePerson);
}

async function findWriteTimeDuplicate(input: {
  deps: ContactImportApplyDeps;
  ownerUserId: string;
  personId: string;
  method: { type: "email" | "phone"; value: string; normalizedValue: string };
}): Promise<ContactMethodDuplicateMatch | null> {
  const [duplicate] = await input.deps.findOwnerContactMethodDuplicates({
    ownerUserId: input.ownerUserId,
    methods: [input.method],
  });
  if (!duplicate || duplicate.personId === input.personId) {
    return null;
  }
  return duplicate;
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
  const advisoryMatches = hasExistingPersonMatch
    ? []
    : sanitizeAdvisoryMatches(
        await (deps.fuzzyMatcher?.rankPossibleMatches({ ownerUserId, contact, people }) ?? []),
        people,
      );
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
  if (advisoryMatches.length > 0) {
    score += advisoryMatches[0]?.confidence === "high" ? 45 : 25;
    reasons.push(`Possible match: ${advisoryMatches[0]?.displayName}`);
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
          : advisoryMatches.length > 0
            ? "advisory_match"
            : emails.length > 0 || birthday || normalizedPhones.length > 0
              ? "individual_review"
              : "weak_match";
  const safeBulkEligible = reviewState === "safe_recommendation";
  const summaryMatchedPerson = matchedPerson
    ? { id: matchedPerson.id, displayName: matchedPerson.displayName }
    : null;
  const decisions = buildCandidateDecisions({
    reviewState,
    safeBulkEligible,
    matchedPerson: summaryMatchedPerson,
    advisoryMatches,
    conflicts,
  });

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
    decisions,
    fingerprint: candidateFingerprint({
      providerContactId: contact.providerContactId,
      displayName: contact.displayName,
      emails,
      phones,
      birthday,
      reviewState,
      safeBulkEligible,
      matchedPersonId: summaryMatchedPerson?.id ?? null,
      decisions,
    }),
    matchSignals,
    advisoryMatches,
    conflicts,
    matchedPerson: summaryMatchedPerson,
  };
}

function sanitizeAdvisoryMatches(
  matches: ContactImportFuzzyMatch[],
  people: Awaited<ReturnType<ContactImportPreviewDeps["searchPeople"]>>,
): ContactImportFuzzyMatch[] {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const seen = new Set<string>();
  return matches.flatMap((match) => {
    const person = peopleById.get(match.personId);
    if (!person || seen.has(person.id)) {
      return [];
    }
    seen.add(person.id);
    return [
      {
        ...match,
        displayName: person.displayName,
      },
    ];
  });
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
