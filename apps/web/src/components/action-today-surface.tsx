import Link from "next/link";
import { ActionRoutineChip, ActionScopeChip } from "@/components/general-action-shared";
import type { ActionTodayItem } from "@/lib/action-today";
import { type ActionTodayGroup, actionTodayCaption } from "@/lib/action-today";

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
          Nothing on today. Your due, overdue, and resurfaced actions will show up here.
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
 * A single calm Today row, linking to the Actions ledger to act. Title leads; a quiet
 * muted caption states its honest timeliness ("Was due Jul 3", "Came back around"),
 * and the Routine and shared/household chips carry cadence and audience without color
 * or count. Private Actions carry no scope chip so the surface stays uncluttered.
 */
function ActionTodayRow({ item }: { item: ActionTodayItem }) {
  const { view } = item;
  return (
    <li>
      {/* Deep-link to the exact row on the Actions ledger, which scrolls to and briefly
          highlights it — the glance carries forward to the act rather than dumping the
          user at the top of the list to re-find the item. */}
      <Link
        className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
        href={`/actions#action-${view.id}`}
      >
        <span className="font-medium text-[length:var(--text-body)] leading-snug">
          {view.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[length:var(--text-caption)] text-muted-foreground">
            {actionTodayCaption(item)}
          </span>
          {view.isRoutine && view.recurrenceLabel ? (
            <ActionRoutineChip label={view.recurrenceLabel} />
          ) : null}
          <ActionScopeChip label={view.visibilityLabel} scope={view.scope} />
        </span>
      </Link>
    </li>
  );
}
