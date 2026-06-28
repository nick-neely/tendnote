"use server";

import { generateDraft } from "@tendnote/db/queries/drafts";
import { messageDraftPurposeSchema } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";

/**
 * Narrow entry-point input for starting a Tendnote draft from a product surface
 * (PRD #75, issue #79). Every entry point — person page, due follow-up, suggested
 * follow-up review point, brief item — passes explicit context here and calls the
 * one shared generator, so drafting policy is never duplicated. Follow-up/brief
 * context carries the id and a short reason/title used as grounding and as the
 * persisted source reference.
 */
const createDraftSchema = z.object({
  personId: z.uuid(),
  purpose: messageDraftPurposeSchema.optional(),
  followupContext: z.object({ id: z.uuid(), reason: z.string().min(1) }).optional(),
  briefItemContext: z
    .object({ id: z.uuid(), title: z.string().min(1), reason: z.string().min(1).optional() })
    .optional(),
});

export type CreateDraftResult = {
  outcome: "created" | "skipped";
  personId: string;
  draftId: string | null;
};

/**
 * Owner-scoped action that creates a Tendnote-only draft from explicit relationship
 * context and routes the user into the persisted draft review flow on the person
 * page. It never sends or creates anything externally. A skipped outcome (thin or
 * ineligible context) returns no draft so the caller can explain instead of
 * showing a misleading one.
 */
export async function createDraftAction(
  input: z.input<typeof createDraftSchema>,
): Promise<CreateDraftResult> {
  const parsed = createDraftSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();

  const outcome = await generateDraft({
    ownerUserId,
    personId: parsed.personId,
    purpose: parsed.purpose,
    followupContext: parsed.followupContext,
    briefItemContext: parsed.briefItemContext,
  });

  if (outcome.status === "created") {
    revalidatePath(`/people/${parsed.personId}`);
    return { outcome: "created", personId: parsed.personId, draftId: outcome.draft.id };
  }

  return { outcome: "skipped", personId: parsed.personId, draftId: null };
}
