import { listDraftsForPerson } from "@tendnote/db/queries/drafts";
import { messageDraftStatusSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../../../lib/owner";

const inputSchema = z.object({
  personId: z
    .uuid()
    .describe("The resolved person whose existing Tendnote drafts should inform strategy."),
  statuses: z
    .array(messageDraftStatusSchema)
    .optional()
    .describe("Optional draft status filter. Omit to read all drafts for the person."),
});

export default defineTool({
  description:
    "Read existing owner-scoped Tendnote Message Drafts for one resolved person so strategy can account for already-started outreach. This is read-only and must not create, edit, approve, externalize, or send drafts.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const drafts = await listDraftsForPerson({
      ownerUserId,
      personId: input.personId,
      statuses: input.statuses,
    });

    return {
      drafts: drafts.map((draft) => ({
        id: draft.id,
        personId: draft.personId,
        channel: draft.channel,
        purpose: draft.purpose,
        status: draft.status,
        body: draft.body,
        sourceRefs: draft.sourceRefs.map((sourceRef) => ({
          kind: sourceRef.kind,
          id: sourceRef.id,
          label: sourceRef.label,
          trust: sourceRef.trust,
        })),
        createdAt: draft.createdAt.toISOString(),
        updatedAt: draft.updatedAt.toISOString(),
      })),
      guidance:
        "These are existing Tendnote drafts only. Do not claim they were sent or saved externally; durable draft changes require the root draft tools and explicit owner intent.",
    };
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        count: output.drafts.length,
        drafts: output.drafts.map((draft) => ({
          id: draft.id,
          channel: draft.channel,
          purpose: draft.purpose,
          status: draft.status,
          body: draft.body,
          sourceRefs: draft.sourceRefs.map((sourceRef) => ({
            kind: sourceRef.kind,
            id: sourceRef.id,
            label: sourceRef.label,
            trust: sourceRef.trust,
          })),
        })),
        guidance: output.guidance,
      },
    };
  },
});
