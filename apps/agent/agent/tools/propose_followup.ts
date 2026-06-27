import { suggestFollowup } from "@tendnote/db/queries/followups";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  personId: z
    .uuid()
    .describe(
      "The resolved person the suggestion is for. Resolve identity with search_people first.",
    ),
  reason: z
    .string()
    .min(1)
    .describe("Why following up might help, in plain language (e.g. 'check in about the move')."),
  dueAt: z
    .string()
    .describe(
      "A concrete proposed due date as an ISO 8601 string. Resolve relative phrases to a concrete date; if timing is ambiguous, ask the user instead of calling this tool.",
    ),
  sourceRecordId: z
    .uuid()
    .describe(
      "The source record this suggestion is grounded in — the note you just logged, the source record under review, or one returned by get_person_context/search. A suggestion must be grounded.",
    ),
  directlyRequested: z
    .boolean()
    .optional()
    .describe(
      "Set true ONLY when the user directly asked about this delicate context. Restricted source records are excluded from proactive suggestion by default.",
    ),
});

/**
 * Thin wrapper over the shared review-gated suggestion path (PRD #42, ADR-0006).
 * Eve proposes follow-ups only in explicit flows — after logging a note, reviewing
 * a source record or memory, viewing a person, or being asked whether to follow up
 * — never from a background scan. The suggestion is persisted as `suggested` and
 * stays tentative until the user accepts it; it is grounded in a source record and
 * excludes restricted context unless the user directly asked. This never creates an
 * active reminder (use create_followup for that, only on an explicit ask).
 */
export default defineTool({
  description:
    "Propose a SUGGESTED follow-up for the user to review — never an active reminder. Use this only in an explicit flow (just logged a note, reviewing a source record or memory, viewing a person, or the user asked 'should I follow up?'). Requires a resolved personId, a reason, a concrete proposed dueAt, and the sourceRecordId it is grounded in. Do NOT use this to scan everyone and invent follow-ups, and do NOT rank who to check in with. The result is tentative until the user accepts it; render it for review and let the user accept, edit, or dismiss. Returns the persisted suggestion reference; name the person, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const result = await suggestFollowup({
      ownerUserId,
      personId: input.personId,
      reason: input.reason,
      // Parsed here; the shared layer rejects anything that isn't a concrete date.
      dueAt: new Date(input.dueAt),
      sourceRecordId: input.sourceRecordId,
      directlyRequested: input.directlyRequested,
    });

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
});
