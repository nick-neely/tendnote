import type { RecordSurfacingState } from "@tendnote/domain";
import { MoonIcon, PauseIcon } from "@/components/icons";

/**
 * The one calm timing cue for surfaced records. Due states use a clay accent,
 * upcoming/undated states stay quiet, and deliberate pauses carry their own icon.
 *
 * `emphasis="quiet"` keeps the same words in the same place but drops the clay,
 * for surfaces that show several dated rows at once. Clay marks one important
 * moment per screen (DESIGN.md §3); a panel where every row wears it says nothing
 * except that the screen is loud. State is still carried by the label text, so a
 * quiet chip loses no meaning, only emphasis.
 */
export function RecordTimingChip({
  state,
  label,
  emphasis = "accent",
}: {
  state: RecordSurfacingState;
  label: string;
  emphasis?: "accent" | "quiet";
}) {
  if (state === "deferred") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[length:var(--text-caption)] text-muted-foreground">
        <MoonIcon aria-hidden className="size-3" />
        {label}
      </span>
    );
  }

  if (state === "paused") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[length:var(--text-caption)] text-muted-foreground">
        <PauseIcon aria-hidden className="size-3" />
        {label}
      </span>
    );
  }

  if (state === "upcoming" || state === "unscheduled" || emphasis === "quiet") {
    return (
      <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
        {label}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {label}
    </span>
  );
}
