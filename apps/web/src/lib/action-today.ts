import type { ActionSurfacingReason } from "@tendnote/domain";
import { classifyActionSurfacing } from "@tendnote/domain";
import type { GeneralActionLinkedAssetView, GeneralActionView } from "@/lib/general-action-view";

/**
 * One surfacing Action on the narrow Action Today surface: its serialized view plus the
 * calm reason it is on today (ADRs 0157, 0158). The reason drives which quiet group the
 * row sits under; the view carries the pre-resolved labels the row renders.
 */
export type ActionTodayItem = {
  reason: ActionSurfacingReason;
  view: GeneralActionView;
};

/** A quiet group of same-reason items, with the calm heading the surface renders. */
export type ActionTodayGroup = {
  reason: ActionSurfacingReason;
  heading: string;
  items: ActionTodayItem[];
};

/**
 * The order the groups read in, and their calm, non-judgmental headings. What you
 * chose for now leads — things due today, then the ones you deliberately set aside to
 * come back today — and the gentle catch-up ("Earlier") follows last, never as a
 * backlog to clear. Overdue is never "overdue"/"missed" and never red (DESIGN.md §3).
 */
const GROUP_ORDER: readonly ActionSurfacingReason[] = ["due_today", "resurfaced", "overdue"];

const GROUP_HEADING: Record<ActionSurfacingReason, string> = {
  due_today: "Today",
  resurfaced: "Came back",
  overdue: "Earlier",
};

/**
 * The calm per-row caption on the Today surface. Deliberately quieter than the Actions
 * ledger's accent chip: on a page where everything is already "today", pulling each row
 * with an accent pill is redundant pressure. Each caption carries the row's *own* honest
 * timeliness — "Was due Jul 3", "Due today", "Set aside until Jul 5" — so it stands on
 * its own without echoing its group heading ("Came back", "Earlier", "Today"). The view
 * label already reads a resurfaced row as "Set aside until …", which says why it is back
 * without repeating the heading.
 */
export function actionTodayCaption(item: ActionTodayItem): string {
  return item.view.surfaceLabel;
}

/**
 * The Assets a Today row names — the thing the work is about (#203). "Replace the
 * filter" is a different job depending on *which* filter, and the whole point of Asset
 * Memory is that Tendnote now knows; a row that has an Asset should say so, and let the
 * glance carry through to the Profile where the model number and the receipt live.
 *
 * Pending proposals are deliberately dropped. A hint still working its way through
 * asset review is review state, and Today is not a review surface — showing an "in
 * review" chip here would put a second, unactionable to-do on a page whose only job is
 * to name what is on today. The Actions ledger already shows that state, where it can
 * be acted on. Only durable, navigable Assets earn a chip on the glance.
 */
export function actionTodayAssets(item: ActionTodayItem): GeneralActionLinkedAssetView[] {
  return item.view.linkedAssets.filter((asset) => !asset.pending);
}

/**
 * Selects, from a caller's active Actions, exactly the ones on today — due, overdue, or
 * resurfaced — pairing each with its reason and pre-built view. The selection boundary
 * is the shared {@link classifyActionSurfacing} predicate, so this narrow surface can
 * never disagree with the scoped summary about what is on today: an unscheduled someday
 * action, a future-dated one, a not-yet-arrived deferral, a paused Routine, and every
 * terminal action all fall away here (ADRs 0149, 0157).
 */
export function selectActionTodayItems(
  actions: ReadonlyArray<{
    action: { status: GeneralActionView["status"]; dueAt: Date | null; deferUntil: Date | null };
    view: GeneralActionView;
  }>,
  now: Date,
): ActionTodayItem[] {
  const items: ActionTodayItem[] = [];
  for (const { action, view } of actions) {
    const reason = classifyActionSurfacing(action, now);
    if (reason) {
      items.push({ reason, view });
    }
  }
  return items;
}

/**
 * Buckets the surfacing items into the fixed calm group order, dropping any empty
 * group so the surface renders only the sections that have something in them.
 */
export function groupActionTodayItems(items: ReadonlyArray<ActionTodayItem>): ActionTodayGroup[] {
  return GROUP_ORDER.flatMap((reason) => {
    const groupItems = items.filter((item) => item.reason === reason);
    if (groupItems.length === 0) {
      return [];
    }
    return [{ reason, heading: GROUP_HEADING[reason], items: groupItems }];
  });
}
