import { searchRelationshipContext } from "@tendnote/db/queries/relationship-context-search";
import { searchRelationshipContextSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Exact Recall search over canonical Tendnote records. In the current slice, it searches stored people and approved memories; a later slice extends the same contract to active source records. Returns compact typed references with snippets, record ids, related person metadata, trust level, and sensitivity. Use this for names and specific text in stored relationship context. Do not use it as identity disambiguation (`search_people`) or as a full known-person context loader (`get_person_context`). It does not return full profiles or generated context snapshot prose.",
  inputSchema: searchRelationshipContextSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const results = await searchRelationshipContext({ ...input, ownerUserId });

    return {
      results,
      component: {
        type: "relationship_context_search",
        resultCount: results.length,
      },
    };
  },
});
