/**
 * A calm, neutral presence indicator for a tab — informative, never a red overdue
 * badge or backlog count. Hidden when the tab is empty; capped so it stays a
 * glance, not a number to clear. Tints toward the brand sage when its tab is
 * active.
 *
 * Contract: the parent `TabsTrigger` must carry `group/tab` so the active tint
 * (`group-data-[state=active]/tab:`) can resolve. Pure markup — safe to render
 * from both server and client components.
 */
export function TabCount({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }

  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 font-medium text-[length:var(--text-caption)] text-foreground tabular-nums transition-colors group-data-[state=active]/tab:bg-primary/15 group-data-[state=active]/tab:text-primary">
      {count > 9 ? "9+" : count}
    </span>
  );
}
