import { listGeneralActionAreas } from "@tendnote/db/queries/general-action-areas";
import type { GeneralActionWithContext } from "@tendnote/db/queries/general-actions";
import {
  listActiveGeneralActions,
  listPausedGeneralActions,
  listResolvedGeneralActions,
} from "@tendnote/db/queries/general-actions";
import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";
import { type OwnerDay, ownerLocalDayStart } from "../lib/owner-day";
import { withModelSafeStoreErrors } from "../lib/store-errors";

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
type ListLedger = NonNullable<z.infer<typeof inputSchema>["ledger"]>;

/** The owner-scoped list reader for a ledger choice. */
function readerForLedger(ledger: ListLedger) {
  if (ledger === "paused") {
    return listPausedGeneralActions;
  }
  if (ledger === "resolved") {
    return listResolvedGeneralActions;
  }
  return listActiveGeneralActions;
}

/**
 * Applies the client-side window and Routine filters (active ledger only) and the caller's
 * post-filter limit. The window filter only makes sense over live surfacing rows, so paused
 * Routines and resolved actions pass through untouched.
 */
function applyActiveListFilters(
  actions: GeneralActionWithContext[],
  input: { window?: ListWindow; routinesOnly?: boolean; limit?: number },
  // `day` travels with the window rather than beside it: a window is the only thing
  // that needs the owner's calendar, and pairing them makes it impossible to filter
  // on a date without having read whose day it is.
  flags: { window: { window: ListWindow; day: OwnerDay } | null; postFilters: boolean },
): GeneralActionWithContext[] {
  let result = actions;
  if (flags.window) {
    const { window, day } = flags.window;
    result = result.filter((action) => matchesWindow(action, window, day));
  }
  if (input.routinesOnly) {
    result = result.filter((action) => action.recurrence !== null);
  }
  if (flags.postFilters && input.limit !== undefined) {
    result = result.slice(0, input.limit);
  }
  return result;
}

/**
 * The surfacing instant the active ledger is ordered by: the resurface date when
 * deferred, else the due date, else null for an unscheduled action. Mirrors the shared
 * store's `coalesce(deferUntil, dueAt)` ordering so a window filter matches the order.
 */
function surfacingTime(action: GeneralActionWithContext): Date | null {
  return action.deferUntil ?? action.dueAt;
}

/**
 * Whether an action's surfacing instant falls before the start of the OWNER's
 * local day `daysAhead` from their today.
 *
 * The cutoff has to be the owner's midnight, not the server's: this service runs
 * in UTC, so a server-day boundary hides an evening action from a Pacific owner
 * asking "what's due today?" and starts calling tomorrow's work overdue.
 */
function surfacesBefore(
  action: GeneralActionWithContext,
  day: OwnerDay,
  daysAhead: number,
): boolean {
  const surfacing = surfacingTime(action);
  return surfacing !== null && surfacing.getTime() < ownerLocalDayStart(day, daysAhead).getTime();
}

/** Whether a deferred action's resurface date has arrived (as of `now`). */
function isResurfaced(action: GeneralActionWithContext, now: Date): boolean {
  return (
    action.status === "deferred" &&
    action.deferUntil !== null &&
    action.deferUntil.getTime() <= now.getTime()
  );
}

/** Applies one date/state window to the active ledger. A plain filter, never ranking. */
function matchesWindow(
  action: GeneralActionWithContext,
  window: ListWindow,
  day: OwnerDay,
): boolean {
  switch (window) {
    case "unscheduled":
      return action.dueAt === null && action.deferUntil === null;
    case "deferred":
      return action.status === "deferred";
    case "resurfaced":
      return isResurfaced(action, day.now);
    case "overdue":
      return surfacesBefore(action, day, 0);
    case "today":
      return surfacesBefore(action, day, 1);
    case "this_week":
      return surfacesBefore(action, day, 7);
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

    // With a client-side window/Routine filter, a store `limit` could starve the
    // result — windows like 'unscheduled' sort last, so a store LIMIT would truncate
    // them away before the filter runs. Fetch unbounded when we post-filter, then apply
    // the caller's limit after filtering; otherwise push the limit down to the store.
    const activeWindow = ledger === "active" ? input.window : undefined;
    const postFilters = activeWindow !== undefined || Boolean(input.routinesOnly);

    const read = readerForLedger(ledger);
    const [fetched, window, areas] = await withModelSafeStoreErrors(() =>
      Promise.all([
        read({ ownerUserId, limit: postFilters ? undefined : input.limit }),
        // The owner's own calendar day, so a window is measured against their
        // midnight and not the server's. Read only when a window asks for it.
        activeWindow === undefined
          ? null
          : getOwnerTodayContext({ ownerUserId }).then((day) => ({ window: activeWindow, day })),
        // The owner's Areas, archived included: an action filed under an Area the
        // owner later archived is still filed there, and saying "Home" is more use
        // than saying nothing. One small flat read (ADR 0146), so the ledger can be
        // described by the name the user gave it rather than by an unnamed id.
        listGeneralActionAreas({ ownerUserId, includeArchived: true }),
      ]),
    );
    const actions = applyActiveListFilters(fetched, input, { window, postFilters });

    return {
      found: true as const,
      ledger,
      window: input.window ?? null,
      count: actions.length,
      actions: actions.map(toGeneralActionRef),
      areaNames: Object.fromEntries(areas.map((area) => [area.id, area.name])),
    };
  },
  // Ids are for the model's follow-up tool calls, not the reply. Project the list down
  // to id-free refs; the chat renders the matches as an expandable list, so the model
  // summarizes rather than reprinting every row.
  toModelOutput(output) {
    const areaNames = new Map(Object.entries(output.areaNames));
    return {
      type: "json" as const,
      value: {
        ledger: output.ledger,
        window: output.window,
        count: output.count,
        actions: output.actions.map((action) => toGeneralActionModelRef(action, areaNames)),
        rendered: "The ledger is shown to the user as an expandable list card.",
        guidance:
          "A plain ledger list (not priority ranking), shown to the user as an expandable list. Summarize briefly — how many, the gist — rather than reprinting each row; act on a specific action (complete, defer, edit) only on the user's explicit say-so. `area` is the Area an action is filed under: say its name, never its id, and reuse that id only to re-file the action when the user asks.",
      },
    };
  },
});
