"use server";

import { generateDraft } from "@tendnote/db/queries/drafts";
import { messageDraftPurposeSchema } from "@tendnote/domain";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";

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

type CreateDraftResult = {
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
export async function createDraftAction(input: z.input<typeof createDraftSchema>) {
  return runOwnerAction({
    schema: createDraftSchema,
    input,
    budget: { costCategory: "server-action" },
    body: ({ ownerUserId, input: parsed }) =>
      generateDraft({
        ownerUserId,
        personId: parsed.personId,
        purpose: parsed.purpose,
        followupContext: parsed.followupContext,
        briefItemContext: parsed.briefItemContext,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome): CreateDraftResult =>
      outcome.result.status === "created"
        ? {
            outcome: "created",
            personId: input.personId,
            draftId: outcome.result.draft.id,
          }
        : { outcome: "skipped", personId: input.personId, draftId: null },
  });
}
