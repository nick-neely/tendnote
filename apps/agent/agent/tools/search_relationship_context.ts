import { searchRelationshipContext } from "@tendnote/db/queries/relationship-context-search";
import { exactRecallResultSchema, searchRelationshipContextSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Exact Recall search over canonical Tendnote records visible to the caller: their private records plus selected-member shared and whole-household records they can access. Returns compact typed references with snippets, record ids, related person metadata, trust level, sensitivity, and visibility provenance. Use this for literal text search, cross-person exact recall, and any recall question that asks for household-visible, shared, visible-to-specific-people, or private-only context. Phrase visibility carefully: 'Only me' is the caller's private note, 'Specific people' is selected-member shared context, and 'Whole household' is household context. For visibility-scoped named-person questions, resolve identity with search_people, pass personId here, answer only from records matching the requested visibility, and explicitly say private-only records were excluded when the user asks for household-visible or shared context. If the user gives a private detail only to exclude it, never repeat that detail; call it private-only context instead. For ordinary named-person questions like 'what do I know about Alex's job search?' that do not ask for visibility filtering, use search_people then get_person_context instead; do not treat an empty exact search as proof there is no context for a known person. Do not use it as identity disambiguation (`search_people`) or as a full known-person context loader (`get_person_context`). It does not return full profiles or generated context snapshot prose.",
  inputSchema: searchRelationshipContextSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const results = exactRecallResultSchema
      .array()
      .parse(await searchRelationshipContext({ ...input, ownerUserId }));

    return {
      results,
      component: {
        type: "relationship_context_search",
        resultCount: results.length,
      },
    };
  },
  // Record ids, related-person ids, and matched-field internals are for the chat
  // component and your follow-up tool calls — not your reply. Strip them from the
  // model's view; channels still get the full structured output for rendering.
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        count: output.results.length,
        results: output.results.map((result) => ({
          kind: result.recordKind,
          label: result.label,
          person: result.relatedPersonDisplayName ?? null,
          snippet: result.snippet,
          trust: result.trustLevel,
          sensitivity: result.sensitivity,
          visibility: result.visibilityLabel,
          visibilityChoice: result.visibilityChoice,
        })),
      },
    };
  },
});
