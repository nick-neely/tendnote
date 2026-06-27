import { searchSemanticContext } from "@tendnote/db/queries/semantic-retrieval";
import { searchSemanticContextSchema, semanticRetrievalResultSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Semantic relationship-context search over approved memories and eligible logged source records. Use this for fuzzy stored-context questions like gift ideas, career updates, preferences, and stressful life events when the user may not remember the exact wording. Returns compact typed references with snippets, related person metadata, similarity, trust level, and sensitivity. Do not use this for exact text lookup (`search_relationship_context`), identity lookup (`search_people`), full known-person context loading (`get_person_context`), proactive agenda ranking, or generated answers.",
  inputSchema: searchSemanticContextSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const results = semanticRetrievalResultSchema
      .array()
      .parse(await searchSemanticContext({ ...input, ownerUserId }));

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
        })),
      },
    };
  },
});
