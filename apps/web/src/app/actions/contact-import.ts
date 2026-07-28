"use server";

import {
  applyOwnerContactImportCandidates,
  type ContactImportCandidateConfirmation,
} from "@tendnote/db/queries/contacts-import-preview";
import { z } from "zod";
import {
  createOwnerContactImportAdapter,
  getOwnerContactImportPreview,
} from "@/lib/integrations/contact-import-preview-data";
import { runOwnerAction } from "@/lib/owner-action";

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

const safeImportSchema = z.object({
  candidates: z.array(z.object({ candidateId: z.string().min(1), fingerprint: z.string().min(1) })),
});
const explicitImportSchema = z.object({
  candidateId: z.string().min(1),
  fingerprint: z.string().min(1),
  targetPersonId: z.string().nullable().optional(),
  createPerson: z.boolean().optional(),
  birthdayChoice: z.enum(["provider", "existing", "skip"]).optional(),
});
const noInputSchema = z.undefined();

export async function confirmSafeContactImportCandidatesAction(
  input: ConfirmSafeContactImportInput,
) {
  return runOwnerAction({
    schema: safeImportSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) =>
      applyOwnerContactImportCandidates({
        ownerUserId,
        mode: "safe_bulk",
        confirmations: parsed.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          expectedFingerprint: candidate.fingerprint,
        })),
        adapter: await createOwnerContactImportAdapter({ allowFixture: false }),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}

export async function confirmContactImportCandidateAction(
  input: ConfirmContactImportCandidateInput,
) {
  return runOwnerAction({
    schema: explicitImportSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) =>
      applyOwnerContactImportCandidates({
        ownerUserId,
        mode: "explicit",
        confirmations: [toConfirmation(parsed)],
        adapter: await createOwnerContactImportAdapter({ allowFixture: false }),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
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

/** Provider data stays interaction-started; this action is never route-prefetched or cached. */
export async function loadContactImportPreviewAction() {
  return runOwnerAction({
    schema: noInputSchema,
    input: undefined,
    body: ({ ownerUserId }) => getOwnerContactImportPreview(ownerUserId),
    result: (preview) => preview,
  });
}
