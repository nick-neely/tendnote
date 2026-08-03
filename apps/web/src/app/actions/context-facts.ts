"use server";

import {
  archiveSelfContextFact,
  deleteSelfContextFact,
  restoreSelfContextFact,
  updateSelfContextFact,
} from "@tendnote/db/queries/context-facts";
import { selfContextFactCategorySchema } from "@tendnote/domain/context-facts";
import { sensitivitySchema } from "@tendnote/domain/privacy";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import type {
  SelfContextCategory,
  SelfContextFactDeleteResult,
  SelfContextFactMutationResult,
} from "@/lib/context-fact-view";
import { runOwnerAction } from "@/lib/owner-action";
import type { SelfContextFactActionInput } from "@/lib/self-context-fact-action";
import { createSelfContextFactActionForChannel as createSelfContextFactActionForChannelShared } from "@/lib/self-context-fact-action";

const contentSchema = z
  .string()
  .trim()
  .min(1, "Add a concise fact.")
  .max(500, "Keep the fact to 500 characters or fewer.");
const updateSelfContextFactActionSchema = z
  .object({
    contextFactId: z.uuid("Choose an active fact."),
    expectedUpdatedAt: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .optional(),
    category: selfContextFactCategorySchema,
    content: contentSchema,
    sensitivity: sensitivitySchema,
  })
  .strict();

const archiveSelfContextFactActionSchema = z
  .object({
    contextFactId: z.uuid("Choose an active fact."),
    expectedUpdatedAt: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .optional(),
  })
  .strict();

const restoreSelfContextFactActionSchema = z
  .object({
    contextFactId: z.uuid("Choose an archived fact."),
    expectedArchivedAt: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .optional(),
  })
  .strict();

const deleteSelfContextFactActionSchema = z
  .object({ contextFactId: z.uuid("Choose a Self Context fact.") })
  .strict();

export type { SelfContextFactActionInput };

export type UpdateSelfContextFactActionInput = {
  contextFactId: string;
  expectedUpdatedAt?: string;
  category: SelfContextCategory;
  content: string;
  sensitivity: z.infer<typeof sensitivitySchema>;
};

export type ArchiveSelfContextFactActionInput = {
  contextFactId: string;
  expectedUpdatedAt?: string;
};

export type RestoreSelfContextFactActionInput = {
  contextFactId: string;
  expectedArchivedAt?: string;
};

export type DeleteSelfContextFactActionInput = {
  contextFactId: string;
};

export async function createSelfContextFactAction(
  input: SelfContextFactActionInput,
): Promise<SelfContextFactMutationResult> {
  return createSelfContextFactActionForChannelShared(input, "account");
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
          expectedUpdatedAt: parsed.expectedUpdatedAt,
          category: parsed.category,
          content: parsed.content,
          sensitivity: parsed.sensitivity,
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({ fact: outcome.result, decision: outcome.decision }),
  });
}

export async function archiveSelfContextFactAction(
  input: ArchiveSelfContextFactActionInput,
): Promise<SelfContextFactMutationResult> {
  return runOwnerAction({
    schema: archiveSelfContextFactActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      archiveSelfContextFact(
        {
          callerUserId: ownerUserId,
          contextFactId: parsed.contextFactId,
          expectedUpdatedAt: parsed.expectedUpdatedAt,
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({ fact: outcome.result, decision: outcome.decision }),
  });
}

export async function restoreSelfContextFactAction(
  input: RestoreSelfContextFactActionInput,
): Promise<SelfContextFactMutationResult> {
  return runOwnerAction({
    schema: restoreSelfContextFactActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      restoreSelfContextFact(
        {
          callerUserId: ownerUserId,
          contextFactId: parsed.contextFactId,
          expectedArchivedAt: parsed.expectedArchivedAt,
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({ fact: outcome.result, decision: outcome.decision }),
  });
}

/** Permanent deletion is deliberately separate from archive and never an Eve action. */
export async function deleteSelfContextFactAction(
  input: DeleteSelfContextFactActionInput,
): Promise<SelfContextFactDeleteResult> {
  return runOwnerAction({
    schema: deleteSelfContextFactActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      deleteSelfContextFact(
        { callerUserId: ownerUserId, contextFactId: parsed.contextFactId },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}
