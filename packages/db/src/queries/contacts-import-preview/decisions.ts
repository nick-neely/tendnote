import { createHash } from "node:crypto";
import type { Person } from "@tendnote/domain";
import type {
  ContactImportCandidateConflict,
  ContactImportCandidateDecisions,
  ContactImportCandidateReviewState,
  ContactImportCandidateTarget,
  ContactImportFuzzyMatch,
} from "./types";

/**
 * Candidate decision policy and the confirmation fingerprint, kept together and
 * apart from preview assembly and apply so the "what may the owner do, and did
 * the reviewed candidate change" rules have one home.
 */

export function buildCandidateDecisions(input: {
  reviewState: ContactImportCandidateReviewState;
  safeBulkEligible: boolean;
  matchedPerson: Pick<Person, "id" | "displayName"> | null;
  advisoryMatches: ContactImportFuzzyMatch[];
  conflicts: ContactImportCandidateConflict[];
}): ContactImportCandidateDecisions {
  const targets = buildTargetOptions(input.matchedPerson, input.advisoryMatches);
  const canCreatePerson = canCreateForReviewState(input.reviewState);
  return {
    targets,
    // A confirmed single match is preselected; an unconfirmed set of possible
    // people must be chosen explicitly before anything is attached.
    targetChoiceRequired: !input.matchedPerson && targets.length > 0,
    canCreatePerson,
    birthdayChoiceRequired: input.conflicts.some((conflict) => conflict.type === "birthday"),
    resolvable: input.safeBulkEligible || targets.length > 0 || canCreatePerson,
  };
}

function buildTargetOptions(
  matchedPerson: Pick<Person, "id" | "displayName"> | null,
  advisoryMatches: ContactImportFuzzyMatch[],
): ContactImportCandidateTarget[] {
  const targets: ContactImportCandidateTarget[] = [];
  const seen = new Set<string>();
  if (matchedPerson) {
    targets.push({ personId: matchedPerson.id, label: matchedPerson.displayName, kind: "matched" });
    seen.add(matchedPerson.id);
  }
  for (const match of advisoryMatches) {
    if (seen.has(match.personId)) {
      continue;
    }
    seen.add(match.personId);
    targets.push({
      personId: match.personId,
      label: `${match.displayName} (${match.reason})`,
      kind: "advisory",
    });
  }
  return targets;
}

function canCreateForReviewState(reviewState: ContactImportCandidateReviewState): boolean {
  return reviewState === "individual_review" || reviewState === "weak_match";
}

/**
 * A stable digest of everything a confirmation decision depends on: candidate
 * identity, the fields that would be written, the matched person, and the
 * allowed decisions. If the provider response changes any of these between
 * preview and apply, the fingerprint changes and apply refuses the row. Emails
 * and phones are sorted because their order is not decision-relevant.
 */
export function candidateFingerprint(input: {
  providerContactId: string;
  displayName: string;
  emails: string[];
  phones: string[];
  birthday: string | null;
  reviewState: ContactImportCandidateReviewState;
  safeBulkEligible: boolean;
  matchedPersonId: string | null;
  decisions: ContactImportCandidateDecisions;
}): string {
  const payload = JSON.stringify({
    providerContactId: input.providerContactId,
    displayName: input.displayName,
    emails: [...input.emails].sort(),
    phones: [...input.phones].sort(),
    birthday: input.birthday,
    reviewState: input.reviewState,
    safeBulkEligible: input.safeBulkEligible,
    matchedPersonId: input.matchedPersonId,
    canCreatePerson: input.decisions.canCreatePerson,
    targetChoiceRequired: input.decisions.targetChoiceRequired,
    birthdayChoiceRequired: input.decisions.birthdayChoiceRequired,
    targets: input.decisions.targets.map((target) => `${target.kind}:${target.personId}`).sort(),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}
