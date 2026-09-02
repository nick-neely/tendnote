import { searchRelationshipContext } from "@tendnote/db/queries/relationship-context-search";
import { exactRecallResultSchema, searchRelationshipContextSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireRestrictedRevealApproval } from "../lib/approval";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

export default defineTool({
  // `directlyRequested` is the model's own assertion that the user asked for a
  // delicate topic, and it is the only thing standing between an injected
  // instruction and a restricted record. Setting it now parks the call for the
  // owner instead of unlocking anything; an ordinary search is untouched.
  approval: requireRestrictedRevealApproval(),
  description:
    "Exact Recall search over canonical Tendnote records visible to the caller. You MUST choose visibilityScope for every call: use 'shared' for household-visible/shared/specific-people questions, 'private_only' for Only-me/private-only questions, and 'all_visible' only when the user did not request a visibility boundary. The tool enforces that scope before results reach you. Returns compact typed references with snippets, record ids, related person metadata, trust level, sensitivity, and visibility provenance. For visibility-scoped named-person questions, first call search_people by itself, wait for its result, and only then call this tool with the exact returned personId; never batch both calls in parallel and never omit personId. Explicitly say private-only records were excluded when the user asks for household-visible or shared context. If the user gives a private detail only to exclude it, never repeat that detail; call it private-only context instead. For ordinary named-person questions like 'what do I know about Alex's job search?' that do not ask for visibility filtering, use search_people then get_person_context instead; do not treat an empty exact search as proof there is no context for a known person. Do not use it as identity disambiguation (`search_people`) or as a full known-person context loader (`get_person_context`). It does not return full profiles or generated context snapshot prose. Restricted records stay out unless the user explicitly asked for them; `directlyRequested` is how you ask, and only that argument puts the call in front of the user. If they decline, answer from the ordinary records instead of asking again. The ordinary search needs no permission — run it and answer.",
  // The review-gated flag (owner-only access to unaccepted suggested actions) is a
  // deliberate caller decision, not a model-facing toggle, so it is omitted here and
  // defaults to false; the general search never surfaces un-accepted proposals.
  inputSchema: searchRelationshipContextSchema.omit({ includeReviewGated: true }).extend({
    visibilityScope: z
      .enum(["all_visible", "private_only", "shared"])
      .describe(
        "Required result boundary. 'shared' permits only Specific people and Whole household records; 'private_only' permits only Only me records; 'all_visible' is for unscoped exact recall.",
      ),
  }),
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const { visibilityScope, ...query } = input;
    const allResults = exactRecallResultSchema
      .array()
      // Pin includeReviewGated to false after spreading input: review context is an
      // owner-only caller decision, never model-forwarded, so a hallucinated flag (or one
      // that survives a future schema refactor) can never surface un-accepted proposals.
      .parse(
        await withModelSafeStoreErrors(() =>
          searchRelationshipContext({
            ...query,
            visibilityScope,
            includeReviewGated: false,
            ownerUserId,
          }),
        ),
      );
    const results = allResults.filter((result) => {
      if (visibilityScope === "all_visible") return true;
      if (visibilityScope === "private_only") return result.visibilityChoice === "only_me";
      return (
        result.visibilityChoice === "selected_members" ||
        result.visibilityChoice === "whole_household"
      );
    });

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
        rendered: "The matching records are shown to the user in a results card.",
        guidance:
          "Don't reprint the snippets — the card shows them. Answer the question in a line or two and add what the card does not say.",
      },
    };
  },
});
