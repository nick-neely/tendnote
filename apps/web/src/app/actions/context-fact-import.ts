"use server";

import { importSelfContextFacts } from "@tendnote/db/queries/context-fact-imports";
import {
  contextFactImportProviderSchema,
  contextFactImportTextSchema,
} from "@tendnote/domain/context-fact-import";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import type {
  ImportSelfContextFactsActionInput,
  SelfContextImportResult,
} from "@/lib/context-fact-import-view";
import { runOwnerAction } from "@/lib/owner-action";
import { toSuggestedContextFactReviewView } from "@/lib/suggested-context-fact-review-view";

const importSelfContextFactsActionSchema = z
  .object({ provider: contextFactImportProviderSchema, text: contextFactImportTextSchema })
  .strict();

export type { ImportSelfContextFactsActionInput };

/**
 * Reads one paste into review-gated Self Context.
 *
 * The budget is charged at the model rate even though a well-formed paste never
 * reaches a model: the caller cannot know which path a given paste will take, and
 * the cheaper category would leave the extraction fallback unguarded.
 */
export async function importSelfContextFactsAction(
  input: ImportSelfContextFactsActionInput,
): Promise<SelfContextImportResult> {
  return runOwnerAction({
    schema: importSelfContextFactsActionSchema,
    input,
    budget: { costCategory: "llm-extraction" },
    body: ({ ownerUserId, input: parsed }) =>
      importSelfContextFacts(
        { callerUserId: ownerUserId, provider: parsed.provider, text: parsed.text },
        requireAdmittedOwnerForAction,
      ),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({
      summary: outcome.summary,
      reviews: outcome.reviews.map(toSuggestedContextFactReviewView),
    }),
  });
}
