"use server";

import {
  applyOwnerContactImportCandidates,
  type ContactImportApplyResult,
  type ContactImportCandidateConfirmation,
} from "@tendnote/db/queries/contacts-import-preview";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import {
  type PeopleMutationScope,
  peopleMutationScopes,
  updatePeopleMutationScopes,
} from "@/lib/cache/people-mutation-scopes";
import { createOwnerContactImportAdapter } from "@/lib/integrations/contact-import-preview-data";

export type ConfirmSafeContactImportInput = {
  candidates: Array<{ candidateId: string; fingerprint: string }>;
};

export type ConfirmContactImportCandidateInput = {
  candidateId: string;
  fingerprint: string;
  targetPersonId?: string | null;
  createPerson?: boolean;
  birthdayChoice?: "provider" | "existing" | "skip";
};

export type ContactImportMutationResult = ContactImportApplyResult & {
  affectedScopes: PeopleMutationScope[];
  revision: string;
};

function authoritativeImportResult(
  ownerUserId: string,
  result: ContactImportApplyResult,
): ContactImportMutationResult {
  const scopes = new Map<string, PeopleMutationScope>();
  for (const scope of peopleMutationScopes.forCollection({ ownerUserId })) {
    scopes.set(`${scope.kind}:${ownerUserId}`, scope);
  }
  for (const candidate of result.candidates) {
    for (const scope of peopleMutationScopes.forPerson({
      ownerUserId,
      personId: candidate.personId,
    })) {
      const key =
        scope.kind === "person"
          ? `${scope.kind}:${scope.personId}`
          : `${scope.kind}:${candidate.personId}`;
      scopes.set(key, scope);
    }
  }
  const affectedScopes = [...scopes.values()];
  updatePeopleMutationScopes(affectedScopes);
  return {
    ...result,
    affectedScopes,
    revision:
      result.candidates
        .map((candidate) => candidate.personId)
        .sort()
        .join(",") || "no-change",
  };
}

/**
 * Confirm safe-recommendation candidates in bulk. Returns the apply result to
 * the client, which fires a sonner toast and optimistically removes the rows.
 * The people list is revalidated so it reflects new/updated people.
 */
export async function confirmSafeContactImportCandidatesAction(
  input: ConfirmSafeContactImportInput,
): Promise<ContactImportMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await applyOwnerContactImportCandidates({
    ownerUserId,
    mode: "safe_bulk",
    confirmations: input.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      expectedFingerprint: candidate.fingerprint,
    })),
    adapter: await createOwnerContactImportAdapter({ allowFixture: false }),
  });

  return authoritativeImportResult(ownerUserId, result);
}

/**
 * Confirm a single review candidate with an explicit resolution (target person,
 * create-new, or birthday choice). Returns the apply result to the client.
 */
export async function confirmContactImportCandidateAction(
  input: ConfirmContactImportCandidateInput,
): Promise<ContactImportMutationResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await applyOwnerContactImportCandidates({
    ownerUserId,
    mode: "explicit",
    confirmations: [toConfirmation(input)],
    adapter: await createOwnerContactImportAdapter({ allowFixture: false }),
  });

  return authoritativeImportResult(ownerUserId, result);
}

function toConfirmation(
  input: ConfirmContactImportCandidateInput,
): ContactImportCandidateConfirmation {
  const targetPersonId = input.targetPersonId?.trim() ?? "";

  return {
    candidateId: input.candidateId,
    expectedFingerprint: input.fingerprint,
    action: "apply",
    targetPersonId: targetPersonId || null,
    createPerson: input.createPerson ?? false,
    birthdayChoice: input.birthdayChoice,
  };
}
