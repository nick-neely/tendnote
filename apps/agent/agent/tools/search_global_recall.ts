import { searchGlobalRecall } from "@tendnote/db/queries/global-recall";
import {
  globalRecallResponseSchema,
  globalRecallToolInputSchema,
} from "@tendnote/domain/global-recall";
import { defineTool } from "eve/tools";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

export default defineTool({
  description:
    "Global Recall across People and relationship context, Follow-Ups, Actions and Routines, Assets and reviewed Asset Memories, Saved Items, and available Calendar events. Use it for cross-domain questions or when the likely record family is unclear. It returns the same policy-filtered Exact then Related records as Search, with canonical citations, trust, visibility, and honest limitations. Raw Source Records and Asset Evidence are grounding only, never answers. Answer only from returned records; describe Related matches as related, and repeat every limitation that affects the answer. Set includeRestricted only when the user explicitly asks to reveal targeted restricted context and the query itself names the target; never use it speculatively.",
  inputSchema: globalRecallToolInputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const response = globalRecallResponseSchema.parse(
      await withModelSafeStoreErrors(() => searchGlobalRecall({ ...input, ownerUserId })),
    );
    return {
      ...response,
      component: { type: "global_recall", resultCount: response.results.length },
    };
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        query: output.query,
        count: output.results.length,
        results: output.results.map((result) => ({
          family: result.family,
          label: result.label,
          text: result.supportingText,
          match: result.match,
          lifecycle: result.lifecycle,
          trust: result.trust,
          sensitivity: result.sensitivity,
          visibility: result.visibility?.label ?? null,
          canonical: result.canonical,
          citations: result.grounding,
          details: result.details,
        })),
        limitations: output.limitations,
        hasMore: output.hasMore,
        guidance:
          "Cite the canonical records supplied here. Exact is stronger than Related. " +
          "Grounding references support a canonical result but are not independent claims. " +
          "State relevant limitations and never infer hidden records from counts or gaps.",
      },
    };
  },
});
