import { getSelfContextFact } from "@tendnote/db/queries/context-facts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { toSelfContextFactToolView } from "../lib/self-context-fact-view";

const inputSchema = z.object({
  contextFactId: z.uuid().describe("The exact Self Context fact id returned by a prior tool call."),
  includeRestricted: z
    .boolean()
    .optional()
    .describe("Set true only for a direct relevant request about a restricted fact."),
  includeArchived: z
    .boolean()
    .optional()
    .describe("Set true only when the user explicitly asks to inspect an archived fact."),
});

export default defineTool({
  description:
    "Look up one exact authenticated Self Context fact by the id returned from a prior Self Context tool call. Use this to inspect a fact before an explicit correction, archive, or restore. Never guess an id, and never show it to the user.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const fact = await getSelfContextFact(
      {
        callerUserId: ownerUserId,
        contextFactId: input.contextFactId,
        includeRestricted: input.includeRestricted ?? false,
        includeArchived: input.includeArchived ?? false,
      },
      async () => ownerUserId,
    );

    return {
      found: fact !== null,
      fact: fact ? toSelfContextFactToolView(fact) : null,
      guidance: "Use only the exact stored wording. Do not turn one fact into a profile.",
    };
  },
});
