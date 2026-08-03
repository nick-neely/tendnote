import { listSelfContextFacts } from "@tendnote/db/queries/context-facts";
import { selfContextFactCategories } from "@tendnote/domain/context-facts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { toSelfContextFactToolView } from "../lib/self-context-fact-view";

const inputSchema = z.object({
  includeRestricted: z
    .boolean()
    .optional()
    .describe(
      "Set true only when the user directly asks about a relevant delicate or restricted Self Context fact. Defaults to false.",
    ),
  includeArchived: z
    .boolean()
    .optional()
    .describe("Set true only when the user explicitly asks to see archived Self Context facts."),
});

/** Exact, categorized Self Context recall; this never generates a profile. */
export default defineTool({
  description:
    "List the authenticated user's exact active Self Context facts, grouped by category, for questions such as 'what do you know about me?' or 'what have you saved about me?'. Use only for direct Self Context recall, not for a generated biography or personality profile. Sensitive facts may be used when relevant; restricted facts are omitted unless the user directly asks about a relevant restricted topic. Set includeArchived only for an explicit archived-fact request. The returned ids are handles for later tool calls and must never appear in the reply.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const facts = await listSelfContextFacts(
      {
        callerUserId: ownerUserId,
        includeRestricted: input.includeRestricted ?? false,
        includeArchived: input.includeArchived ?? false,
      },
      async () => ownerUserId,
    );
    const exactFacts = facts.map(toSelfContextFactToolView);
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
      guidance:
        "These are exact stored facts, not a generated profile. Keep categories and wording literal; do not infer personality, emotion, values, finances, capabilities, or importance.",
    };
  },
});
