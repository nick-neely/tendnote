import { listSelfContextFacts } from "@tendnote/db/queries/context-facts";
import { toSelfContextResult } from "@tendnote/db/queries/global-recall";
import type { ContextFactView, SelfContextCategory } from "@tendnote/domain/context-facts";
import { selfContextFactCategories } from "@tendnote/domain/context-facts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { toSelfContextFactToolView } from "../lib/self-context-fact-view";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  includeArchived: z
    .boolean()
    .optional()
    .describe("Set true only when the user explicitly asks to see archived Self Context facts."),
});

/** Exact, categorized Self Context recall; this returns facts without synthesis. */
export default defineTool({
  description:
    "List the authenticated user's exact active Self Context facts, grouped by category, for questions such as 'what do you know about me?' or 'what have you saved about me?'. Use only for direct Self Context recall, not for speculative biography or persona synthesis. Restricted facts are never returned by this tool; use the explicit Global Recall path for an owner-authorized restricted lookup. Set includeArchived only for an explicit archived-fact request. The typed results include the canonical About you link and grounding citation for each fact. The returned ids are handles for later tool calls and must never appear in the reply.",
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
    const exactFacts = facts.map(toSelfContextFactToolView);
    const recallFacts = facts.filter(
      (fact): fact is ContextFactView & { category: SelfContextCategory } =>
        fact.category !== "composition",
    );
    const results = recallFacts.map((fact) =>
      toSelfContextResult({ fact, matchedFields: ["content", "category"] }),
    );
    const factsByCategory = Object.fromEntries(
      selfContextFactCategories.map((category) => [
        category,
        exactFacts.filter((fact) => fact.category === category),
      ]),
    );

    return {
      found: exactFacts.length > 0,
      count: exactFacts.length,
      facts: exactFacts,
      factsByCategory,
      results,
      guidance:
        "These are exact stored facts. Keep categories and wording literal; do not add interpretations about emotion, values, finances, capabilities, or importance. When a fact needs explanation, cite the matching canonical result and use its About you link for correction.",
    };
  },
});
