import { searchSemanticContext } from "@tendnote/db/queries/semantic-retrieval";
import { searchSemanticContextSchema, semanticRetrievalResultSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Semantic relationship-context search over approved memories, eligible logged source records, and General Actions and Routines (durable to-dos) visible to the caller: their private records plus selected-member shared and whole-household records they can access. Use this for fuzzy stored-context questions like gift ideas, career updates, preferences, stressful life events, and 'what do I need to do about X' when the user may not remember the exact wording. Returns compact typed references with snippets, related person metadata, similarity, trust level, sensitivity, and visibility provenance; General Action references also carry whether the item is a Routine or Suggested. Phrase visibility carefully: 'Only me' is the caller's private note, 'Specific people' is selected-member shared context, and 'Whole household' is household context. Do not use this for exact text lookup (`search_relationship_context`), identity lookup (`search_people`), full known-person context loading (`get_person_context`), proactive agenda ranking, or generated answers.",
  // The review-gated flag (owner-only access to unaccepted suggested actions) is a
  // deliberate caller decision, not a model-facing toggle, so it is omitted here and
  // defaults to false; the general search never surfaces un-accepted proposals.
  inputSchema: searchSemanticContextSchema.omit({ includeReviewGated: true }),
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const results = semanticRetrievalResultSchema
      .array()
      // Pin includeReviewGated to false after spreading input: review context is an
      // owner-only caller decision, never model-forwarded, so a hallucinated flag (or one
      // that survives a future schema refactor) can never surface un-accepted proposals.
      .parse(await searchSemanticContext({ ...input, includeReviewGated: false, ownerUserId }));

    return {
      results,
      component: {
        type: "semantic_context_search",
        resultCount: results.length,
      },
    };
  },
  // Record/person ids are for the chat component and your follow-up tool calls, not
  // your reply. Strip them from the model's view; channels still get the full
  // structured output for rendering.
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        count: output.results.length,
        results: output.results.map((result) => ({
          kind: result.recordKind,
          person: result.relatedPersonDisplayName ?? null,
          snippet: result.snippet,
          similarity: result.similarity,
          trust: result.trustLevel,
          sensitivity: result.sensitivity,
          visibility: result.visibilityLabel,
          visibilityChoice: result.visibilityChoice,
        })),
      },
    };
  },
});
