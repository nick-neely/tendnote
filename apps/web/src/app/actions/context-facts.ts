"use server";

import { createSelfContextFact, updateSelfContextFact } from "@tendnote/db/queries/context-facts";
import { selfContextFactCategorySchema } from "@tendnote/domain/context-facts";
import { sensitivitySchema } from "@tendnote/domain/privacy";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import type { SelfContextCategory, SelfContextFactMutationResult } from "@/lib/context-fact-view";
import { runOwnerAction } from "@/lib/owner-action";

const contentSchema = z
  .string()
  .trim()
  .min(1, "Add a concise fact.")
  .max(500, "Keep the fact to 500 characters or fewer.");
const sensitivityInputSchema = sensitivitySchema.default("normal");

const createSelfContextFactActionSchema = z
  .object({
    category: selfContextFactCategorySchema,
    content: contentSchema,
    sensitivity: sensitivityInputSchema,
  })
  .strict();

const updateSelfContextFactActionSchema = z
  .object({
    contextFactId: z.uuid("Choose an active fact."),
    category: selfContextFactCategorySchema,
    content: contentSchema,
    sensitivity: sensitivitySchema,
  })
  .strict();

export type SelfContextFactActionInput = {
  category: SelfContextCategory;
  content: string;
  sensitivity?: z.input<typeof sensitivityInputSchema>;
};

export type UpdateSelfContextFactActionInput = {
  contextFactId: string;
  category: SelfContextCategory;
  content: string;
  sensitivity: z.infer<typeof sensitivitySchema>;
};

export async function createSelfContextFactAction(
  input: SelfContextFactActionInput,
): Promise<SelfContextFactMutationResult> {
  return runOwnerAction({
    schema: createSelfContextFactActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      createSelfContextFact(
        {
          callerUserId: ownerUserId,
          category: parsed.category,
          content: parsed.content,
          sensitivity: parsed.sensitivity,
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}

export async function updateSelfContextFactAction(
  input: UpdateSelfContextFactActionInput,
): Promise<SelfContextFactMutationResult> {
  return runOwnerAction({
    schema: updateSelfContextFactActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      updateSelfContextFact(
        {
          callerUserId: ownerUserId,
          contextFactId: parsed.contextFactId,
          category: parsed.category,
          content: parsed.content,
          sensitivity: parsed.sensitivity,
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}
