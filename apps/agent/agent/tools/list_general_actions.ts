import type { GeneralActionWithContext } from "@tendnote/db/queries/general-actions";
import {
  listActiveGeneralActions,
  listPausedGeneralActions,
  listResolvedGeneralActions,
} from "@tendnote/db/queries/general-actions";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  ledger: z
    .enum(["active", "paused", "resolved"])
    .optional()
    .describe(
      "Which ledger to read. 'active' (default) = open and deferred actions still on the user's plate; 'paused' = paused Routines set aside; 'resolved' = recently completed or dismissed actions.",
    ),
  window: z
    .enum(["today", "this_week", "overdue", "unscheduled", "deferred", "resurfaced"])
    .optional()
    .describe(
      "Optional filter over the ACTIVE ledger (ignored for paused/resolved): 'today' = surfacing today or earlier, 'this_week' = within the next seven days, 'overdue' = past its date, 'unscheduled' = no date set (someday), 'deferred' = deliberately set aside, 'resurfaced' = deferred and its resurface date has arrived. A plain date filter, not priority ranking.",
    ),
  routinesOnly: z
    .boolean()
    .optional()
    .describe("When true, return only Routines (recurring actions). Omit for all actions."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max actions to return, soonest-surfacing first. Defaults to a small set."),
});

type ListWindow = NonNullable<z.infer<typeof inputSchema>["window"]>;

/** Local midnight of `daysAhead` from today, for exclusive end-of-window cutoffs. */
function startOfDay(daysAhead: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead);
}

/**
 * The surfacing instant the active ledger is ordered by: the resurface date when
 * deferred, else the due date, else null for an unscheduled action. Mirrors the shared
 * store's `coalesce(deferUntil, dueAt)` ordering so a window filter matches the order.
 */
function surfacingTime(action: GeneralActionWithContext): Date | null {
  return action.deferUntil ?? action.dueAt;
}

/** Applies one date/state window to the active ledger. A plain filter, never ranking. */
function matchesWindow(action: GeneralActionWithContext, window: ListWindow, now: Date): boolean {
  switch (window) {
    case "unscheduled":
      return action.dueAt === null && action.deferUntil === null;
    case "deferred":
      return action.status === "deferred";
    case "resurfaced":
      return (
        action.status === "deferred" &&
        action.deferUntil !== null &&
        action.deferUntil.getTime() <= now.getTime()
      );
    case "overdue": {
      const surfacing = surfacingTime(action);
      return surfacing !== null && surfacing.getTime() < startOfDay(0).getTime();
    }
    case "today": {
      const surfacing = surfacingTime(action);
      return surfacing !== null && surfacing.getTime() < startOfDay(1).getTime();
    }
    case "this_week": {
      const surfacing = surfacingTime(action);
      return surfacing !== null && surfacing.getTime() < startOfDay(7).getTime();
    }
  }
}

/**
 * Thin wrapper over the shared owner-scoped General Action lists (ADRs 0149, 0157).
 * Reads the active, paused, or resolved ledger the caller may see — their own plus the
 * shared and household actions owned by active co-members, already scope-filtered by
 * the store — and applies an optional plain date/state window and Routine filter here.
 * This is exact ledger recall ("what's due?", "what's overdue?", "my routines"), not
 * proactive priority ranking. Each item is a compact reference so the model names the
 * action by its title, never a raw id.
 */
export default defineTool({
  description:
    "List General Actions and Routines (durable to-dos) visible to the caller — their own plus shared and whole-household ones — soonest-surfacing first. Use for 'what do I need to do?', 'what's overdue?', 'anything due this week?', 'what did I defer?', 'show my routines', or 'what have I finished lately?'. Choose a ledger (active/paused/resolved), an optional window (today, this_week, overdue, unscheduled, deferred, resurfaced), and routinesOnly to narrow to Routines. This is a plain ledger + date filter, NOT priority or 'what should I do first' ranking. Returns compact references (title, status, timing, cadence, people, visibility); name actions by their title, preserve visibility provenance when it matters, and never show raw ids.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const ledger = input.ledger ?? "active";

    const read =
      ledger === "paused"
        ? listPausedGeneralActions
        : ledger === "resolved"
          ? listResolvedGeneralActions
          : listActiveGeneralActions;

    // With a client-side window/Routine filter, a store `limit` could starve the
    // result — windows like 'unscheduled' sort last, so a store LIMIT would truncate
    // them away before the filter runs. Fetch unbounded when we post-filter, then apply
    // the caller's limit after filtering; otherwise push the limit down to the store.
    const windowsActive = input.window !== undefined && ledger === "active";
    const postFilters = windowsActive || Boolean(input.routinesOnly);
    let actions = await read({ ownerUserId, limit: postFilters ? undefined : input.limit });

    // The window filter only makes sense over the active ledger (open/deferred rows);
    // paused Routines and resolved actions have no live surfacing window.
    if (windowsActive && input.window) {
      const now = new Date();
      const { window } = input;
      actions = actions.filter((action) => matchesWindow(action, window, now));
    }
    if (input.routinesOnly) {
      actions = actions.filter((action) => action.recurrence !== null);
    }
    if (postFilters && input.limit !== undefined) {
      actions = actions.slice(0, input.limit);
    }

    return {
      found: true as const,
      ledger,
      window: input.window ?? null,
      count: actions.length,
      actions: actions.map(toGeneralActionRef),
    };
  },
  // Ids are for the model's follow-up tool calls, not the reply. Project the list down
  // to id-free refs and remind the model to summarize.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        ledger: output.ledger,
        window: output.window,
        count: output.count,
        actions: output.actions.map(toGeneralActionModelRef),
        guidance:
          "A plain ledger list, not priority ranking. Summarize what's there naturally; act on a specific action (complete, defer, edit) only on the user's explicit say-so.",
      },
    };
  },
});
