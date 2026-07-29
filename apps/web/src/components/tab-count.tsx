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

  const label = count > 9 ? "9+" : String(count);

  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 font-medium text-[length:var(--text-caption)] text-foreground tabular-nums transition-colors group-data-[state=active]/tab:bg-primary/15 group-data-[state=active]/tab:text-primary">
      {/* The badge sits inside the tab's label, so with nothing between them the
          accessible name ran together as "Review3". The separator and the number
          have to be one text node - name computation trims each node on its own,
          so a lone ", " would collapse straight back against the digit. The
          visible copy is hidden from the name to keep it from being read twice;
          `sr-only` is absolutely positioned, so it costs the badge no width. */}
      <span className="sr-only">{`, ${label}`}</span>
      <span aria-hidden>{label}</span>
    </span>
  );
}
