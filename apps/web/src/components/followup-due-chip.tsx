import type { FollowupDueState } from "@/lib/followup-view";

/**
 * The shared timely-state cue for a follow-up. Calm by design: clay accent (never
 * red) for due/today, quiet muted text for upcoming, and always a word — never
 * color alone (DESIGN.md §3, §6; PRD #42). Past-due reads as a plain "Was due
 * {date}", not guilt language like "overdue/missed"; the accent dot carries the
 * timeliness without a nagging badge. Kept in its own focused module so both the
 * person ledger and the dashboard rail can use it without importing a heavy
 * client component.
 */
export function DueChip({ dueState, dueLabel }: { dueState: FollowupDueState; dueLabel: string }) {
  if (dueState === "upcoming") {
    return (
      <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
        Due {dueLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {dueState === "overdue" ? `Was due ${dueLabel}` : "Due today"}
    </span>
  );
}
