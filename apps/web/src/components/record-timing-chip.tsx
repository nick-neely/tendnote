import type { RecordSurfacingState } from "@tendnote/domain";
import { MoonIcon, PauseIcon } from "@/components/icons";

/**
 * The one calm timing cue for surfaced records. Due states use a clay accent,
 * upcoming/undated states stay quiet, and deliberate pauses carry their own icon.
 */
export function RecordTimingChip({ state, label }: { state: RecordSurfacingState; label: string }) {
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

  if (state === "upcoming" || state === "unscheduled") {
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
