import { createSelfContextFact } from "@tendnote/db/queries/context-facts";
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

export const selfContextFactActionSchema = z
  .object({
    category: selfContextFactCategorySchema,
    content: contentSchema,
    sensitivity: sensitivityInputSchema,
  })
  .strict();

export type SelfContextFactActionInput = {
  category: SelfContextCategory;
  content: string;
  sensitivity?: z.input<typeof sensitivityInputSchema>;
};

export type SelfContextFactActionChannel = "account" | "onboarding";

export async function createSelfContextFactActionForChannel(
  input: SelfContextFactActionInput,
  channel: SelfContextFactActionChannel,
): Promise<SelfContextFactMutationResult> {
  return runOwnerAction({
    schema: selfContextFactActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      createSelfContextFact(
        {
          callerUserId: ownerUserId,
          category: parsed.category,
          content: parsed.content,
          sensitivity: parsed.sensitivity,
          ...(channel === "onboarding"
            ? {
                provenance: {
                  channel: "onboarding" as const,
                  origin: "direct" as const,
                  sourceRecordId: null,
                },
              }
            : {}),
        },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({ fact: outcome.result, decision: outcome.decision }),
  });
}
