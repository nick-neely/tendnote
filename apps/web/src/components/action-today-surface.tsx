import Link from "next/link";
import {
  ActionLinkedAssetChip,
  ActionRoutineChip,
  ActionScopeChip,
} from "@/components/general-action-shared";
import type { ActionTodayItem } from "@/lib/action-today";
import { type ActionTodayGroup, actionTodayAssets, actionTodayCaption } from "@/lib/action-today";

/**
 * The narrow Action Today surface: a quiet, read-first glance at the Actions and
 * Routines that are due, overdue, or deliberately resurfaced today — and nothing else
 * (ADR 0157). It is not the Phase 7 cross-domain Today dashboard: no Calendar, review
 * items, decisions, saved items, or stale context, only General Actions. Deliberately
 * calm — no counts, no badges, no red, no accent pills (on a page that is already
 * "today", highlighting every row is redundant pressure); each item links to the
 * Actions ledger to act (DESIGN.md calm-by-default). A server component with no client
 * state: the glance itself carries no interactivity.
 */
export function ActionTodaySurface({ groups }: { groups: ActionTodayGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-border border-dashed px-4 py-8 text-center">
        <p className="text-[length:var(--text-small)] text-muted-foreground">
          Nothing on today. Actions show up here when they're due or come back around.
        </p>
        <Link
          className="mt-2 inline-block rounded-sm font-medium text-[length:var(--text-small)] text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href="/actions"
        >
          Go to Actions
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section
          aria-labelledby={`action-today-${group.reason}`}
          className="flex flex-col gap-2"
          key={group.reason}
        >
          <h2
            className="px-1 font-medium text-[length:var(--text-small)] text-muted-foreground"
            id={`action-today-${group.reason}`}
          >
            {group.heading}
          </h2>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {group.items.map((item) => (
              <ActionTodayRow item={item} key={item.view.id} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * A single calm Today row. Title leads; a quiet muted caption states its honest
 * timeliness ("Was due Jul 3", "Came back around"), and the Routine and shared/household
 * chips carry cadence and audience without color or count. Private Actions carry no scope
 * chip so the surface stays uncluttered.
 *
 * An Asset chip names the *thing* the work is about when the action has one (#203):
 * "Replace the filter" is a different job depending on which filter, and Asset Memory is
 * precisely what now knows the answer — so the chip deep-links to the Profile where the
 * model number, the receipt, and the history live.
 *
 * The row has two real destinations, so it is a stretched-link card rather than one big
 * anchor: the title's `::after` covers the row (the whole surface stays clickable, and
 * the row's accessible name is still just the action), while the meta strip sits above it
 * so the Asset chip remains its own link and its own tab stop. Nesting the chip inside a
 * row-wide anchor would be invalid HTML and would swallow the chip's destination.
 */
function ActionTodayRow({ item }: { item: ActionTodayItem }) {
  const { view } = item;
  const assets = actionTodayAssets(item);

  return (
    <li className="relative flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-muted/40 motion-reduce:transition-none">
      {/* Deep-link to the exact row on the Actions ledger, which scrolls to and briefly
          highlights it — the glance carries forward to the act rather than dumping the
          user at the top of the list to re-find the item. */}
      <Link
        className="w-fit rounded-sm font-medium text-[length:var(--text-body)] leading-snug after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href={`/actions#action-${view.id}`}
      >
        {view.title}
      </Link>
      <span className="relative flex w-fit flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[length:var(--text-caption)] text-muted-foreground">
          {actionTodayCaption(item)}
        </span>
        {view.isRoutine && view.recurrenceLabel ? (
          <ActionRoutineChip label={view.recurrenceLabel} />
        ) : null}
        {assets.map((asset) => (
          <ActionLinkedAssetChip asset={asset} key={asset.assetId} />
        ))}
        <ActionScopeChip label={view.visibilityLabel} scope={view.scope} />
      </span>
    </li>
  );
}
