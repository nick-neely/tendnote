"use server";

import {
  applyOwnerContactImportCandidates,
  type ContactImportApplyResult,
  type ContactImportCandidateConfirmation,
} from "@tendnote/db/queries/contacts-import-preview";
import { revalidatePath } from "next/cache";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
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

/**
 * Confirm safe-recommendation candidates in bulk. Returns the apply result to
 * the client, which fires a sonner toast and optimistically removes the rows.
 * The people list is revalidated so it reflects new/updated people.
 */
export async function confirmSafeContactImportCandidatesAction(
  input: ConfirmSafeContactImportInput,
): Promise<ContactImportApplyResult> {
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

  revalidatePath("/people");
  return result;
}

/**
 * Confirm a single review candidate with an explicit resolution (target person,
 * create-new, or birthday choice). Returns the apply result to the client.
 */
export async function confirmContactImportCandidateAction(
  input: ConfirmContactImportCandidateInput,
): Promise<ContactImportApplyResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await applyOwnerContactImportCandidates({
    ownerUserId,
    mode: "explicit",
    confirmations: [toConfirmation(input)],
    adapter: await createOwnerContactImportAdapter({ allowFixture: false }),
  });

  revalidatePath("/people");
  return result;
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
