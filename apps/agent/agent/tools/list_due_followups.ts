import { listActiveFollowups } from "@tendnote/db/queries/followups";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  personId: z
    .uuid()
    .optional()
    .describe(
      "Limit to one resolved person's active reminders. Resolve identity with search_people first. Omit for reminders across all people.",
    ),
  window: z
    .enum(["today", "this_week"])
    .optional()
    .describe(
      "Limit to reminders due today or within the next seven days. Omit to list the soonest active reminders. This is a plain due-date filter, not agenda or priority ranking.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max reminders to return, soonest due first. Defaults to a small set."),
});

/**
 * Exclusive end-of-window cutoff in local time: start of tomorrow for "today",
 * seven days out for "this_week". A plain due-date filter — never agenda ranking.
 */
function dueBeforeFor(window?: "today" | "this_week"): Date | undefined {
  if (!window) {
    return undefined;
  }

  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cutoff.setDate(cutoff.getDate() + (window === "today" ? 1 : 7));

  return cutoff;
}

/**
 * Thin wrapper over the shared active follow-up list: the owner's open/snoozed
 * reminders, soonest due first, optionally scoped to one person or a due-date
 * window (PRD #42). This is exact due-date recall, not proactive "who should I
 * check in with" agenda ranking, which Phase 1E does not own. Each item carries
 * the resolved person so the assistant names people instead of raw ids (ADR 0028).
 */
export default defineTool({
  description:
    "List the user's active follow-up reminders (open or snoozed), soonest due first. Use for 'what's due today?', 'what do I owe this week?', or 'what follow-ups do I have for <person>?'. Pass window=today or window=this_week to filter by due date, and/or a resolved personId to scope to one person (resolve identity first). This is a plain due-date list, NOT agenda or 'who should I check in with' ranking. Returns compact references (id, person name, reason, due date, status); refer to people by name and never show raw ids.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const summaries = await listActiveFollowups({
      ownerUserId,
      personId: input.personId,
      dueBefore: dueBeforeFor(input.window),
      limit: input.limit,
    });

    return {
      found: true as const,
      personId: input.personId ?? null,
      count: summaries.length,
      followups: summaries.map((summary) => ({
        id: summary.followup.id,
        reason: summary.followup.reason,
        dueAt: summary.followup.dueAt.toISOString(),
        status: summary.followup.status,
        // Resolved so the assistant names the person, never a raw id (ADR 0028).
        person: summary.person
          ? { id: summary.person.id, displayName: summary.person.displayName }
          : null,
      })),
    };
  },
});
