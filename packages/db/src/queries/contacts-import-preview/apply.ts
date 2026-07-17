import type { Person } from "@tendnote/domain";
import { normalizeEmailContactValue, normalizePhoneContactValue } from "@tendnote/domain";
import type { ContactMethodDuplicateMatch } from "../contact-methods/types";
import type {
  ContactImportApplyDeps,
  ContactImportApplyResult,
  ContactImportAuditEntry,
  ContactImportCandidateConfirmation,
  ContactImportNotImportedCandidate,
  ContactImportNotImportedReason,
  ContactImportPreviewCandidate,
} from "./types";

/**
 * Applying one confirmed candidate: eligibility screening, target resolution,
 * birthday reconciliation, contact-method writes, provenance, and audit.
 *
 * Kept apart from preview assembly so every durable write for a candidate flows
 * through one place. Screening is pure and happens before any IO, so an
 * ineligible or drifted row is refused without touching the database.
 */

export type ContactImportImportedCandidate = ContactImportApplyResult["candidates"][number];

type ImportOutcome =
  | { imported: ContactImportImportedCandidate }
  | { reason: ContactImportNotImportedReason };

type ApplyMode = "safe_bulk" | "explicit";

type CandidateContext = {
  candidate: ContactImportPreviewCandidate;
  confirmation: ContactImportCandidateConfirmation;
  ownerUserId: string;
  deps: ContactImportApplyDeps;
};

/**
 * Everything that can refuse a confirmation before any write, in the order the
 * owner would reason about it: does the row exist, is it still the row they
 * reviewed, did they dismiss it, may it be confirmed in this mode, and is the
 * requested target one the workflow actually offered.
 */
export function screenConfirmation(
  candidate: ContactImportPreviewCandidate,
  confirmation: ContactImportCandidateConfirmation,
  mode: ApplyMode,
): ContactImportNotImportedReason | null {
  if (confirmation.expectedFingerprint !== candidate.fingerprint) {
    // Provider data drifted after the owner reviewed it; report it as stale.
    return "stale";
  }
  if (confirmation.action === "skip") {
    return "skipped";
  }
  const confirmable =
    mode === "safe_bulk"
      ? candidate.safeBulkEligible
      : canExplicitlyConfirm(candidate, confirmation);
  if (!confirmable) {
    return "ineligible";
  }
  // A requested target must be one the workflow offered; anything else is a
  // drift between UI and policy and must not attach to an arbitrary person.
  if (confirmation.targetPersonId && !offersTarget(candidate, confirmation.targetPersonId)) {
    return "missing_target";
  }
  return null;
}

function offersTarget(candidate: ContactImportPreviewCandidate, personId: string): boolean {
  return candidate.decisions.targets.some((target) => target.personId === personId);
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

/** The durable writes for one screened candidate, or the reason it still could not land. */
export async function importConfirmedCandidate(context: CandidateContext): Promise<ImportOutcome> {
  const { candidate, confirmation, ownerUserId, deps } = context;
  const target = await resolveTargetPerson(context);
  if ("reason" in target) {
    return target;
  }
  const { person, createdPerson } = target;

  const birthday = await reconcileBirthday({ ...context, person, createdPerson });
  const methods = await applyContactMethods({ ...context, person });
  const imported: ContactImportImportedCandidate = {
    candidateId: candidate.id,
    providerContactId: candidate.providerContactId,
    personId: person.id,
    displayName: person.displayName,
    createdPerson,
    addedEmails: methods.addedEmails,
    addedPhones: methods.addedPhones,
    addedBirthday: birthday.addedBirthday,
    skipped: [...birthday.skipped, ...methods.skipped],
  };

  await deps.createProviderReference({
    ownerUserId,
    personId: person.id,
    providerKey: "google",
    providerContactId: candidate.providerContactId,
  });
  await deps.createAuditLogEntry(
    candidateAuditEntry({ candidate, confirmation, ownerUserId, imported }),
  );
  return { imported };
}

/**
 * The person this candidate attaches to: an offered target, the deterministic
 * match, or a newly created person when the owner explicitly asked for one and
 * the workflow allows it. A target that no longer resolves is never replaced by
 * a fallback create.
 */
async function resolveTargetPerson(
  context: CandidateContext,
): Promise<
  { person: Person; createdPerson: boolean } | { reason: ContactImportNotImportedReason }
> {
  const { candidate, confirmation, ownerUserId, deps } = context;
  const targetPersonId = confirmation.targetPersonId ?? candidate.matchedPerson?.id ?? null;
  const existingPerson = targetPersonId
    ? await deps.getPerson({ ownerUserId, personId: targetPersonId })
    : null;
  if (targetPersonId && !existingPerson) {
    return { reason: "missing_target" };
  }
  if (existingPerson) {
    return { person: existingPerson, createdPerson: false };
  }
  if (!(confirmation.createPerson && candidate.decisions.canCreatePerson)) {
    return { reason: "ineligible" };
  }
  const person = await deps.createPerson({
    ownerUserId,
    displayName: candidate.displayName,
    birthday: confirmation.birthdayChoice === "skip" ? null : candidate.birthday,
    source: "contact_import",
  });
  return { person, createdPerson: true };
}

/**
 * A provider birthday only overwrites a known Tendnote birthday when the owner
 * explicitly chose the provider value; otherwise the existing value stands and
 * the birthday is reported as skipped.
 */
async function reconcileBirthday(
  context: CandidateContext & { person: Person; createdPerson: boolean },
): Promise<{ addedBirthday: string | null; skipped: string[] }> {
  const { candidate, confirmation, ownerUserId, deps, person, createdPerson } = context;
  if (!candidate.birthday) {
    return { addedBirthday: null, skipped: [] };
  }
  if (createdPerson) {
    // `resolveTargetPerson` already wrote the birthday (or `null`, when the owner
    // chose to skip it) as part of the create, so there is nothing to reconcile —
    // only the honest outcome to report. Reporting a skipped birthday as added here
    // would put a birthday the person does not have into the audit entry.
    return confirmation.birthdayChoice === "skip"
      ? { addedBirthday: null, skipped: ["birthday"] }
      : { addedBirthday: candidate.birthday, skipped: [] };
  }
  const overwrites =
    person.birthday !== candidate.birthday && confirmation.birthdayChoice === "provider";
  if (person.birthday && !overwrites) {
    return { addedBirthday: null, skipped: ["birthday"] };
  }
  const updated = await deps.updatePerson({
    ownerUserId,
    personId: person.id,
    birthday: candidate.birthday,
  });
  return { addedBirthday: updated ? candidate.birthday : null, skipped: [] };
}

/** One provider contact method, paired with the normalized value it would be written as. */
type PlannedContactMethod = {
  type: "email" | "phone";
  displayValue: string;
  normalizedValue: string | null;
};

function plannedContactMethods(candidate: ContactImportPreviewCandidate): PlannedContactMethod[] {
  return [
    ...candidate.emails.map((email) => ({
      type: "email" as const,
      displayValue: email,
      normalizedValue: normalizeEmailContactValue(email),
    })),
    ...candidate.phones.map((phone) => ({
      type: "phone" as const,
      displayValue: phone,
      normalizedValue: normalizePhoneContactValue(phone).normalizedValue,
    })),
  ];
}

async function applyContactMethods(
  context: CandidateContext & { person: Person },
): Promise<{ addedEmails: string[]; addedPhones: string[]; skipped: string[] }> {
  const addedEmails: string[] = [];
  const addedPhones: string[] = [];
  const skipped: string[] = [];

  for (const method of plannedContactMethods(context.candidate)) {
    const added = await applyContactMethod({ ...context, method });
    if (!added) {
      skipped.push(`${method.type}:${method.displayValue}`);
      continue;
    }
    (method.type === "email" ? addedEmails : addedPhones).push(method.displayValue);
  }
  return { addedEmails, addedPhones, skipped };
}

/**
 * Writes one contact method unless it is unusable, already the signal that
 * matched this person, or would become an owner-wide duplicate at write time.
 */
async function applyContactMethod(
  context: CandidateContext & { person: Person; method: PlannedContactMethod },
): Promise<boolean> {
  const { candidate, ownerUserId, deps, person, method } = context;
  const normalizedValue = method.normalizedValue;
  if (!normalizedValue) {
    return false;
  }
  const alreadyMatched = candidate.matchSignals.some(
    (signal) => signal.type === method.type && signal.value === normalizedValue,
  );
  if (alreadyMatched) {
    return false;
  }
  const duplicate = await findWriteTimeDuplicate({
    deps,
    ownerUserId,
    personId: person.id,
    method: { type: method.type, value: method.displayValue, normalizedValue },
  });
  if (duplicate) {
    return false;
  }
  await deps.createContactMethod({
    ownerUserId,
    personId: person.id,
    type: method.type,
    value: normalizedValue,
    displayValue: method.displayValue,
    normalizedValue,
    source: "contact_import",
  });
  return true;
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

/** Minimized provenance: what was written and which resolution the owner chose. */
function candidateAuditEntry(input: {
  candidate: ContactImportPreviewCandidate;
  confirmation: ContactImportCandidateConfirmation;
  ownerUserId: string;
  imported: ContactImportImportedCandidate;
}): ContactImportAuditEntry {
  const { candidate, confirmation, imported } = input;
  return {
    ownerUserId: input.ownerUserId,
    action: "contact_import.candidate_confirmed",
    entityType: "contact_import_candidate",
    entityId: candidate.id,
    metadataJson: {
      providerKey: "google",
      providerContactId: candidate.providerContactId,
      personId: imported.personId,
      createdPerson: imported.createdPerson,
      addedEmails: imported.addedEmails,
      addedPhones: imported.addedPhones,
      addedBirthday: imported.addedBirthday,
      skipped: imported.skipped,
      resolution: {
        action: confirmation.action ?? "apply",
        targetPersonId: confirmation.targetPersonId ?? null,
        createPerson: confirmation.createPerson ?? null,
        birthdayChoice: confirmation.birthdayChoice ?? null,
      },
    },
  };
}

export function summarizeApply(
  candidates: ContactImportImportedCandidate[],
  notImported: ContactImportNotImportedCandidate[],
): ContactImportApplyResult {
  return {
    importedCount: candidates.length,
    createdPeople: candidates.filter((result) => result.createdPerson).length,
    updatedPeople: candidates.filter((result) => !result.createdPerson).length,
    addedContactMethods: candidates.reduce(
      (count, result) => count + result.addedEmails.length + result.addedPhones.length,
      0,
    ),
    addedBirthdays: candidates.filter((result) => result.addedBirthday).length,
    candidates,
    notImported,
    undoAvailable: false,
  };
}

export function emptyApplyResult(errorMessage?: string): ContactImportApplyResult {
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
