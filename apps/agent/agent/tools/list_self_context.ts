import { listSelfContextFacts } from "@tendnote/db/queries/context-facts";
import { toSelfContextResult } from "@tendnote/db/queries/global-recall";
import type { ContextFactView } from "@tendnote/domain/context-facts";
import { contextFactCategoryLabel } from "@tendnote/domain/context-facts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { toSelfContextFactToolView } from "../lib/self-context-fact-view";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * How many facts one unqualified "what do you know about me?" returns.
 *
 * The shared list applies no limit, so the tool used to send the owner's entire
 * Self Context set into a chat turn — three times over, once flat, once grouped by
 * category, and once again as recall rows. Self Context is a small set by design, so
 * this bound is rarely reached; it is a default rather than a cap the model cannot
 * see, and an explicit `limit` up to the schema's maximum still works.
 */
const DEFAULT_SELF_CONTEXT_LIST_LIMIT = 25;

const inputSchema = z.object({
  includeArchived: z
    .boolean()
    .optional()
    .describe("Set true only when the user explicitly asks to see archived Self Context facts."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(DEFAULT_SELF_CONTEXT_LIST_LIMIT)
    .describe(
      "How many facts to return, most recently updated first. Omit for the ordinary small set.",
    ),
});

/**
 * The About you anchor for one fact, from the same normalizer Global Recall uses, so
 * one fact links to one place no matter which tool found it. `composition` is a
 * household-only category a Self fact never carries; the guard narrows to the
 * normalizer's Self input instead of casting past it.
 */
function selfContextCorrectionHref(fact: ContextFactView): string | null {
  if (fact.category === "composition") return null;
  return toSelfContextResult({ fact: { ...fact, category: fact.category }, matchedFields: [] })
    .href;
}

/** Exact, categorized Self Context recall; this returns facts without synthesis. */
export default defineTool({
  description:
    "List the authenticated user's exact active Self Context facts, most recently updated first, for questions such as 'what do you know about me?' or 'what have you saved about me?'. Use only for direct Self Context recall, not for speculative biography or persona synthesis. Restricted facts are never returned by this tool; use the explicit Global Recall path for an owner-authorized restricted lookup. Set includeArchived only for an explicit archived-fact request. Each fact carries its category and label, its exact wording, its canonical About you link, and the id and updatedAt handles a later correction needs. The returned ids are handles for later tool calls and must never appear in the reply.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const facts = await withModelSafeStoreErrors(() =>
      listSelfContextFacts(
        {
          callerUserId: ownerUserId,
          includeRestricted: false,
          includeArchived: input.includeArchived ?? false,
        },
        async () => ownerUserId,
      ),
    );
    // One shape, not three. The flat list, the category grouping, and the recall rows
    // were the same records three times over: the grouping is `category` on each row,
    // and the recall row's one field a caller could not derive is its canonical link.
    const bounded = facts.slice(0, input.limit);

    return {
      found: bounded.length > 0,
      count: bounded.length,
      hasMore: facts.length > bounded.length,
      facts: bounded.map((fact) => ({
        ...toSelfContextFactToolView(fact),
        categoryLabel: contextFactCategoryLabel(fact.category),
        href: selfContextCorrectionHref(fact),
      })),
    };
  },
  /**
   * `toModelOutput` REPLACES what the model sees, so every handle a follow-up call
   * needs has to be here or the model cannot make that call: `id` is what
   * `get_self_context_fact`, `update_self_context`, and `archive_self_context` take,
   * and `updatedAt` is the `expectedUpdatedAt` an explicit correction passes back so
   * a stale edit cannot overwrite a later one.
   *
   * Everything a card would want and the model does not — provenance, trust,
   * authority, visibility, archivedAt, createdAt — stays out: this tool renders no
   * card, so those fields only spent context. The guidance lives here rather than on
   * the result for the same reason: this projection is the only part the model reads,
   * so a second copy on the raw output would be words nothing consumes. Keeping ids
   * out of the *reply* is a different rule, enforced in `instructions/base.md`.
   */
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        count: output.count,
        hasMore: output.hasMore,
        facts: output.facts.map((fact) => ({
          id: fact.id,
          category: fact.category,
          categoryLabel: fact.categoryLabel,
          content: fact.content,
          lifecycle: fact.lifecycle,
          sensitivity: fact.sensitivity,
          updatedAt: fact.updatedAt,
          href: fact.href,
        })),
        guidance:
          "Exact stored facts, most recently updated first. Keep categories and wording literal; " +
          "do not add interpretations about emotion, values, finances, capabilities, or " +
          "importance. Group them by category when it helps the reply; the grouping is the " +
          "category field, not a separate list. When a fact needs explanation, cite it and offer " +
          "its About you link for correction, and pass its updatedAt back as expectedUpdatedAt " +
          "when the user explicitly corrects it. " +
          (output.hasMore
            ? "More facts exist than were returned: say so plainly rather than implying this is everything."
            : "This is every active fact returned for this request."),
      },
    };
  },
});
