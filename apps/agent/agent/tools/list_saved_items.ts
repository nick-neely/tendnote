import { listSavedItems, type SavedItemWithContext } from "@tendnote/db/queries/saved-items";
import { visibilityChoiceForScope, visibilityLabelForScope } from "@tendnote/domain/privacy";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/** How many Saved Items one browse returns when the caller names no limit. */
const DEFAULT_SAVED_ITEM_LIST_LIMIT = 15;

/**
 * How much of a Saved Item's body travels.
 *
 * A Saved Item holds up to 20,000 characters, and a browse of fifteen of them
 * would be the whole turn. The cut is reported as a cut — the field is named
 * `excerpt` and carries a truncation flag — so the model can never relay a
 * clipped note as if it were the user's whole note.
 */
const EXCERPT_LENGTH = 200;

const inputSchema = z.object({
  status: z
    .enum(["active", "archived", "resolved", "all"])
    .default("active")
    .describe(
      "Which Saved Items to read. 'active' (default) = still on the pile; 'archived' = put away; 'resolved' = archived with a stated outcome (an open question the user settled); 'all' = both. There is no other state: a Saved Item is active or archived.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(DEFAULT_SAVED_ITEM_LIST_LIMIT)
    .describe(
      `Max Saved Items to return, most recently touched first. Defaults to ${DEFAULT_SAVED_ITEM_LIST_LIMIT}.`,
    ),
});

type SavedItemStatusFilter = z.infer<typeof inputSchema>["status"];

/** Whether a filter needs rows the active-only read would never return. */
function needsArchived(status: SavedItemStatusFilter): boolean {
  return status !== "active";
}

/**
 * Whether a filter is narrower than the shared read can express.
 *
 * The shared list takes `includeArchived`, not a status, so 'archived' and
 * 'resolved' are both narrowings applied here. A store `limit` would starve them —
 * the read is ordered by recency across both states, so the newest active items
 * would fill the page before the filter ran — which is why the limit is applied
 * after filtering in those two cases (the same shape `list_general_actions` uses
 * for its window filter). The store's own default ceiling still bounds the scan.
 */
function postFilters(status: SavedItemStatusFilter): boolean {
  return status === "archived" || status === "resolved";
}

function matchesStatus(item: SavedItemWithContext, status: SavedItemStatusFilter): boolean {
  if (status === "resolved") {
    return item.status === "archived" && item.resolvedAt !== null;
  }
  if (status === "archived") {
    return item.status === "archived";
  }
  return true;
}

/** The first line of a Saved Item, said to be a first line. */
function excerptOf(content: string | null): { excerpt: string | null; truncated: boolean } {
  const trimmed = content?.trim();
  if (!trimmed) {
    return { excerpt: null, truncated: false };
  }
  if (trimmed.length <= EXCERPT_LENGTH) {
    return { excerpt: trimmed, truncated: false };
  }
  return { excerpt: `${trimmed.slice(0, EXCERPT_LENGTH).trimEnd()}…`, truncated: true };
}

/**
 * The Saved Item pile, readable at last.
 *
 * Capture has been able to *write* a Saved Item since Phase 7, but the only way to
 * read one back was to already know a word inside it and run a global recall search
 * — so "what did I save?", the plainest question there is about the pile, had no
 * answer. This is that answer: a plain recency browse, not a search.
 *
 * The read is the same one the web surface makes (`listSavedItems`, keyed on
 * `callerUserId`), so a household-native item appears here on exactly the terms it
 * appears in the app — visibility-scoped in SQL by the shared seam — and this tool
 * adds no authorization logic of its own (ADR 0214, ADR 0219).
 */
export default defineTool({
  description:
    "Browse the user's Saved Items — the notes, links, and open questions they parked for later, plus the ones their household shares with them — most recently touched first. Use for 'what did I save?', 'what's on my list?', 'anything I parked about the move?', 'what questions did I settle?'. Choose a status: active (default), archived, resolved, or all. This is a plain recency browse, NOT a search: to find one specific saved thing by its wording, use search_global_recall instead. Each item comes back with its kind, title, a short excerpt of the body, its link, its bring-back date, and its visibility — the excerpt may be cut off, so never present it as the user's complete note. Do NOT use this to save something (`capture_saved_item`), to change or archive one (the app owns that), or to read Actions (`list_general_actions`).",
  inputSchema,
  async execute(input, ctx) {
    const callerUserId = resolveOwnerUserId(ctx);
    const filtered = postFilters(input.status);

    const items = await withModelSafeStoreErrors(() =>
      listSavedItems({
        callerUserId,
        includeArchived: needsArchived(input.status),
        limit: filtered ? undefined : input.limit,
      }),
    );

    const matching = filtered ? items.filter((item) => matchesStatus(item, input.status)) : items;
    const shown = matching.slice(0, input.limit);

    return {
      status: input.status,
      count: shown.length,
      truncated: shown.length < matching.length,
      savedItems: shown.map((item) => {
        const { excerpt, truncated } = excerptOf(item.content);
        return {
          id: item.id,
          kind: item.kind,
          title: item.title,
          excerpt,
          excerptTruncated: truncated,
          url: item.url,
          status: item.status,
          // Resolution is a fact about an archived item, not a fourth state: an open
          // question the user settled carries the reason they settled it.
          resolved: item.resolvedAt !== null,
          resolutionReason: item.resolutionReason,
          bringBackAt: item.bringBackAt ? item.bringBackAt.toISOString() : null,
          ownership: item.ownership,
          // A household-native record has no audience anyone chose — it is simply the
          // household's — so no visibility label is offered for one, the same
          // suppression every rendered surface makes (ADR 0214). The ownership form is
          // offered instead, so Eve can still say whose the record is.
          visibilityChoice:
            item.ownership === "household_native" ? null : visibilityChoiceForScope(item.scope),
          visibilityLabel:
            item.ownership === "household_native" ? null : visibilityLabelForScope(item.scope),
          updatedAt: item.updatedAt.toISOString(),
        };
      }),
    };
  },
  /**
   * No `savedItemId` travels, and that is the whole difference from `search_assets`.
   *
   * An id belongs in the model's context when a follow-up tool takes one; no Eve tool
   * takes a `savedItemId` today (Capture's Undo and Change take the opaque target
   * Capture itself returned). So an id here would be a uuid the model could only
   * misuse — put in a reply, or passed to a tool that does not want it.
   */
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        status: output.status,
        count: output.count,
        truncated: output.truncated,
        savedItems: output.savedItems.map((item) => ({
          kind: item.kind,
          title: item.title,
          excerpt: item.excerpt,
          excerptTruncated: item.excerptTruncated,
          url: item.url,
          status: item.status,
          resolved: item.resolved,
          resolutionReason: item.resolutionReason,
          bringBackAt: item.bringBackAt,
          ownership: item.ownership,
          visibilityChoice: item.visibilityChoice,
          visibilityLabel: item.visibilityLabel,
        })),
        guidance:
          output.count === 0
            ? "Nothing is saved under this filter. Say so plainly — an empty pile is a real " +
              "answer, not a failure — and do not widen the search or invent an item. If the " +
              "user is looking for something specific by its wording, `search_global_recall` " +
              "searches the whole notebook."
            : "These are the user's own Saved Items plus the household ones they can see, " +
              "newest change first. Summarize them by title; quote an `excerpt` only as a " +
              "partial line and never as the complete note when `excerptTruncated` is true. " +
              "Reading these changes nothing: archiving, resolving, or promoting a Saved Item " +
              "happens in the app, so offer that rather than claiming to have done it.",
      },
    };
  },
});
