"use server";

import {
  archiveHouseholdContextFact,
  createHouseholdContextFact,
  restoreHouseholdContextFact,
  updateHouseholdContextFact,
} from "@tendnote/db/queries/context-facts";
import { contextFactCategorySchema } from "@tendnote/domain/context-facts";
import { householdContextCategories } from "@tendnote/domain/household-context";
import { sensitivitySchema } from "@tendnote/domain/privacy";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import type {
  HouseholdContextMutationResult,
  HouseholdContextMutationView,
} from "@/lib/household-context-view";
import { runOwnerAction } from "@/lib/owner-action";

const categorySchema = contextFactCategorySchema.extract([...householdContextCategories]);
const contentSchema = z
  .string()
  .trim()
  .min(1, "Write one short thing everyone should know.")
  .max(500, "Keep it to 500 characters or fewer.");

/**
 * The version the member was looking at, required on every write.
 *
 * Serialised as an ISO string because a Server Action boundary is JSON; parsed
 * straight back to a Date so the fence the database applies is the same instant
 * the surface rendered.
 */
const expectedUpdatedAtSchema = z.iso
  .datetime()
  .transform((value) => new Date(value))
  .describe("The version the member saw.");

const createSchema = z
  .object({
    category: categorySchema,
    content: contentSchema,
    sensitivity: sensitivitySchema.default("normal"),
  })
  .strict();

const updateSchema = z
  .object({
    contextFactId: z.uuid("Choose a current household fact."),
    expectedUpdatedAt: expectedUpdatedAtSchema,
    category: categorySchema,
    content: contentSchema,
    sensitivity: sensitivitySchema,
  })
  .strict();

const lifecycleSchema = z
  .object({
    contextFactId: z.uuid("Choose a household fact."),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .strict();

export type CreateHouseholdContextFactActionInput = z.input<typeof createSchema>;
export type UpdateHouseholdContextFactActionInput = {
  contextFactId: string;
  expectedUpdatedAt: string;
  category: z.input<typeof categorySchema>;
  content: string;
  sensitivity: z.input<typeof sensitivitySchema>;
};
export type HouseholdContextLifecycleActionInput = {
  contextFactId: string;
  expectedUpdatedAt: string;
};

/**
 * Both a save and a refused save arrive as `ok: true`.
 *
 * A stale write is an outcome the surface renders, not a protocol failure — the
 * member's draft is intact and the reconciliation is the payload they need. Only
 * a genuine validation refusal (a duplicate, a precise address, a fact that is
 * simply gone) travels as `ok: false`.
 */
function mutationView(outcome: {
  result: HouseholdContextMutationView;
}): HouseholdContextMutationView {
  return outcome.result;
}

export async function createHouseholdContextFactAction(
  input: CreateHouseholdContextFactActionInput,
): Promise<HouseholdContextMutationResult> {
  return runOwnerAction({
    schema: createSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      createHouseholdContextFact(
        {
          callerUserId: ownerUserId,
          category: parsed.category,
          content: parsed.content,
          sensitivity: parsed.sensitivity,
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: mutationView,
  });
}

export async function updateHouseholdContextFactAction(
  input: UpdateHouseholdContextFactActionInput,
): Promise<HouseholdContextMutationResult> {
  return runOwnerAction({
    schema: updateSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      updateHouseholdContextFact(
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
    result: mutationView,
  });
}

export async function archiveHouseholdContextFactAction(
  input: HouseholdContextLifecycleActionInput,
): Promise<HouseholdContextMutationResult> {
  return runOwnerAction({
    schema: lifecycleSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      archiveHouseholdContextFact(
        {
          callerUserId: ownerUserId,
          contextFactId: parsed.contextFactId,
          expectedUpdatedAt: parsed.expectedUpdatedAt,
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: mutationView,
  });
}

export async function restoreHouseholdContextFactAction(
  input: HouseholdContextLifecycleActionInput,
): Promise<HouseholdContextMutationResult> {
  return runOwnerAction({
    schema: lifecycleSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      restoreHouseholdContextFact(
        {
          callerUserId: ownerUserId,
          contextFactId: parsed.contextFactId,
          expectedUpdatedAt: parsed.expectedUpdatedAt,
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: mutationView,
  });
}
