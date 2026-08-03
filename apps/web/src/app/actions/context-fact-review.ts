"use server";

import {
  acceptSuggestedContextFact,
  dismissSuggestedContextFact,
} from "@tendnote/db/queries/context-facts";
import { contextFactReviewEditSchema } from "@tendnote/domain/context-facts";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import type { SelfContextFactMutationView } from "@/lib/context-fact-view";
import { runOwnerAction } from "@/lib/owner-action";
import type { OwnerActionResult } from "@/lib/owner-action-result";

const acceptSuggestedContextFactActionSchema = z
  .object({
    contextFactId: z.uuid("Choose a suggested fact."),
    expectedUpdatedAt: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .optional(),
    edit: contextFactReviewEditSchema.optional(),
  })
  .strict();

const dismissSuggestedContextFactActionSchema = z
  .object({
    contextFactId: z.uuid("Choose a suggested fact."),
    expectedUpdatedAt: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .optional(),
  })
  .strict();

export type AcceptSuggestedContextFactActionInput = {
  contextFactId: string;
  expectedUpdatedAt?: string;
  edit?: z.input<typeof contextFactReviewEditSchema>;
};

export type DismissSuggestedContextFactActionInput = {
  contextFactId: string;
  expectedUpdatedAt?: string;
};

export type SuggestedContextFactMutationView = SelfContextFactMutationView;
export type SuggestedContextFactMutationResult =
  OwnerActionResult<SuggestedContextFactMutationView>;
export type SuggestedContextFactDismissResult = OwnerActionResult<{
  dismissedContextFactId: string;
}>;

export async function acceptSuggestedContextFactAction(
  input: AcceptSuggestedContextFactActionInput,
): Promise<SuggestedContextFactMutationResult> {
  return runOwnerAction({
    schema: acceptSuggestedContextFactActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      acceptSuggestedContextFact(
        {
          callerUserId: ownerUserId,
          contextFactId: parsed.contextFactId,
          expectedUpdatedAt: parsed.expectedUpdatedAt,
          edit: parsed.edit,
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({ fact: outcome.result, decision: outcome.decision }),
  });
}

export async function dismissSuggestedContextFactAction(
  input: DismissSuggestedContextFactActionInput,
): Promise<SuggestedContextFactDismissResult> {
  return runOwnerAction({
    schema: dismissSuggestedContextFactActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      dismissSuggestedContextFact(
        {
          callerUserId: ownerUserId,
          contextFactId: parsed.contextFactId,
          expectedUpdatedAt: parsed.expectedUpdatedAt,
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}
