import { suggestFollowup } from "@tendnote/db/queries/followups";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../../../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../../../lib/request-affected-scope-reconciliation";

const inputSchema = z.object({
  personId: z
    .uuid()
    .describe(
      "The resolved person the suggestion is for. Use agenda source refs or identity lookup.",
    ),
  reason: z
    .string()
    .min(1)
    .describe("Why this tentative next action may help, in plain owner-facing language."),
  dueAt: z
    .string()
    .describe(
      "A concrete proposed due date as an ISO 8601 string. Ask the parent agent for clarification if timing is ambiguous.",
    ),
  sourceRecordId: z
    .uuid()
    .describe(
      "The source record grounding this strategic suggestion. A Suggested Follow-Up must be grounded.",
    ),
  directlyRequested: z
    .boolean()
    .optional()
    .describe(
      "Set true only when the owner directly asked about this restricted or delicate context.",
    ),
});

export default defineTool({
  description:
    "Create a review-gated Suggested Follow-Up from a grounded strategy recommendation. This never creates an active reminder; the owner must accept the review card before it becomes active.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const outcome = await suggestFollowup({
      ownerUserId,
      personId: input.personId,
      reason: input.reason,
      dueAt: new Date(input.dueAt),
      sourceRecordId: input.sourceRecordId,
      directlyRequested: input.directlyRequested,
    });
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const result = outcome.result;

    return {
      found: true as const,
      component: result.component,
      person: result.person
        ? { id: result.person.id, displayName: result.person.displayName }
        : null,
      followup: {
        id: result.followup.id,
        personId: result.followup.personId,
        reason: result.followup.reason,
        dueAt: result.followup.dueAt.toISOString(),
        status: result.followup.status,
      },
      sourceRecord: result.sourceRecord ? { id: result.sourceRecord.id } : null,
    };
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        proposed: true,
        followupId: output.followup.id,
        personId: output.followup.personId,
        person: output.person?.displayName ?? null,
        status: output.followup.status,
        sourceRecordId: output.sourceRecord?.id ?? null,
        rendered:
          "The strategic Suggested Follow-Up is shown to the user in a review card they can accept, edit, or dismiss.",
        guidance:
          "This is tentative, not an active reminder. Do not claim it was accepted or set; the owner must explicitly accept it.",
      },
    };
  },
});
