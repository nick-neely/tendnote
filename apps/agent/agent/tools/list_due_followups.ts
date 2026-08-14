import { listActiveFollowups } from "@tendnote/db/queries/followups";
import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import { visibilityChoiceForScope, visibilityLabelForScope } from "@tendnote/domain/privacy";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { type OwnerDay, ownerLocalDayStart } from "../lib/owner-day";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * How many reminders one unbounded ask returns.
 *
 * The shared store applies no limit when the caller omits one, so "what's due?"
 * used to pull the owner's entire open ledger into a chat turn while the tool's
 * own description promised "a small set". Twenty matches the memories list
 * (`memories/drizzle-store.ts`), and it is a default rather than a cap the model
 * cannot see: an explicit `limit` up to the schema's maximum still works.
 */
const DEFAULT_FOLLOWUP_LIST_LIMIT = 20;

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
    .default(DEFAULT_FOLLOWUP_LIST_LIMIT)
    .describe(
      `Max reminders to return, soonest due first. Defaults to ${DEFAULT_FOLLOWUP_LIST_LIMIT}.`,
    ),
});

/**
 * Exclusive end-of-window cutoff on the OWNER's calendar: the start of their
 * tomorrow for "today", seven of their days out for "this_week". A plain due-date
 * filter — never agenda ranking.
 */
function dueBeforeFor(day: OwnerDay, window?: "today" | "this_week"): Date | undefined {
  if (!window) {
    return undefined;
  }

  return ownerLocalDayStart(day, window === "today" ? 1 : 7);
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
    "List active follow-up reminders visible to the caller (their private reminders plus selected-member shared and whole-household reminders), soonest due first. Use for 'what's due today?', 'what do I owe this week?', or 'what follow-ups do I have for <person>?'. Pass window=today or window=this_week to filter by due date, and/or a resolved personId to scope to one person (resolve identity first). This is a plain due-date list, NOT agenda or 'who should I check in with' ranking. Returns compact references (id, person name, reason, due date, status, visibility); refer to people by name, preserve visibility provenance when it affects actionability, and never show raw ids.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const summaries = await withModelSafeStoreErrors(async () => {
      // "Today" is a question about the owner's calendar, not the server's: the
      // service runs in UTC, so a server-day cutoff drops a Pacific owner's whole
      // evening and, after 4pm, starts folding tomorrow in (ADR 0220 pattern). The
      // day is read only when a window actually needs it.
      const dueBefore = input.window
        ? dueBeforeFor(await getOwnerTodayContext({ ownerUserId }), input.window)
        : undefined;
      return listActiveFollowups({
        ownerUserId,
        personId: input.personId,
        dueBefore,
        limit: input.limit,
      });
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
        visibilityChoice: visibilityChoiceForScope(summary.followup.scope),
        visibilityLabel: visibilityLabelForScope(summary.followup.scope),
        // Resolved so the assistant names the person, never a raw id (ADR 0028).
        person: summary.person
          ? { id: summary.person.id, displayName: summary.person.displayName }
          : null,
      })),
    };
  },
});
