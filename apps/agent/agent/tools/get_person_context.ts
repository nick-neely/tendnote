import { getPersonContext } from "@tendnote/db";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  personId: z
    .uuid()
    .describe("The resolved Tendnote person to load context for. Resolve identity first."),
  includeRestricted: z
    .boolean()
    .optional()
    .describe(
      "Set true ONLY when the user directly asked about delicate/restricted context for this person. Defaults false, which keeps restricted content hidden.",
    ),
});

/**
 * Thin Eve-facing wrapper over the same shared trust-aware retrieval the web
 * profile uses (`getPersonContext`). The response keeps the three trust tiers
 * separate so the model phrases each correctly; the `guidance` block restates
 * the rules at call time, reinforcing the agent instructions (ADR 0004, ADR
 * 0019, ADR 0031).
 */
export default defineTool({
  description:
    "Load trust-aware relationship context for a resolved person. Returns three kinds of context that MUST be phrased differently: `approvedMemories` are CONFIRMED FACTS; `sourceRecords` are LOGGED CONTEXT — phrase as 'you noted' or 'you mentioned', never as established fact; `suggestedMemories` are TENTATIVE review items the user has not approved — never state them as fact. Dismissed, archived, pending, and unresolved records are already excluded. Restricted content is omitted unless the user directly asked (set includeRestricted).",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const context = await getPersonContext({
      ownerUserId,
      personId: input.personId,
      directlyRequested: input.includeRestricted ?? false,
    });

    if (!context.person) {
      return { found: false as const };
    }

    return {
      found: true as const,
      person: {
        id: context.person.id,
        displayName: context.person.displayName,
        relationshipType: context.person.relationshipType,
        birthday: context.person.birthday ?? null,
        profileBlurb: context.person.profileBlurb ?? null,
      },
      // Confirmed facts — safe to state plainly.
      approvedMemories: context.approvedMemories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        sensitivity: memory.sensitivity,
        confidence: memory.confidence,
      })),
      // Logged context — phrase as "you noted" / "you mentioned", not as fact.
      sourceRecords: context.sourceRecords.map((sourceRecord) => ({
        id: sourceRecord.id,
        content: sourceRecord.content,
        sourceType: sourceRecord.sourceType,
        sensitivity: sourceRecord.sensitivity,
        capturedAt: sourceRecord.createdAt.toISOString(),
      })),
      // Tentative review items — not approved; never state as fact.
      suggestedMemories: context.suggestedMemories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        sensitivity: memory.sensitivity,
      })),
      guidance: {
        approvedMemories: "Confirmed facts. State plainly.",
        sourceRecords: "Logged context. Phrase as 'you noted' or 'you mentioned', not as fact.",
        suggestedMemories: "Tentative and unapproved. Offer for review; never assert as fact.",
      },
    };
  },
});
