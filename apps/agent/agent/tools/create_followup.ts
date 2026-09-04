import { createFollowup } from "@tendnote/db/queries/followups";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnerApproval } from "../lib/approval";
import { describeRegisteredSubject } from "../lib/approval/subject-registry";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  personId: z
    .uuid()
    .describe(
      "The resolved person id this reminder is for. Resolve identity with search_people first; never guess.",
    ),
  reason: z
    .string()
    .min(1)
    .describe("Why to follow up, in the user's words (e.g. 'check in about the move')."),
  dueAt: z
    .string()
    .describe(
      "Concrete due date as an ISO 8601 string (e.g. 2026-07-04). Resolve relative phrases like 'next week' to a concrete date first. If the user's timing is ambiguous, ask a clarifying question instead of calling this tool.",
    ),
});

/**
 * Thin wrapper over the shared owner-scoped follow-up lifecycle: creates an active
 * `open` reminder (PRD #42). Only act on an explicit user ask — Eve must never
 * invent an active reminder. The shared layer enforces owner scoping, a real
 * person, and a concrete due date; ambiguous timing should be clarified with the
 * user before calling. Returns a compact persisted reference, never a raw id in
 * prose.
 */
export default defineTool({
  approval: requireOwnerApproval({
    describe: describeRegisteredSubject(),
    reversiblePrivateWrite: true,
  }),
  description:
    "Create an active follow-up reminder for a person. Only call this when the user explicitly asks to be reminded or to follow up — never invent a reminder on their behalf. Requires a resolved personId (use search_people first), a reason, and a concrete dueAt; if the user's timing is vague or ambiguous (e.g. 'sometime', 'soon'), ask a clarifying question instead of guessing a date. Returns the persisted follow-up reference (id, reason, due date, status, plus the person id for your tool calls) — refer to the person by name from context, never show the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      createFollowup({
        ownerUserId,
        personId: input.personId,
        reason: input.reason,
        // Parsed here; the shared layer rejects anything that isn't a concrete date.
        dueAt: new Date(input.dueAt),
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const followup = outcome.result;

    return {
      followup: {
        id: followup.id,
        personId: followup.personId,
        reason: followup.reason,
        dueAt: followup.dueAt.toISOString(),
        status: followup.status,
      },
    };
  },
});
