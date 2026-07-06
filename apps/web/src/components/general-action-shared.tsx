import { MoonIcon } from "lucide-react";
import type { ActionSurfaceState } from "@/lib/general-action-view";

/** Fallback message when an Action mutation fails for an unknown reason. */
export const GENERIC_ERROR = "That didn't go through. Try again.";

/** Inline error line shared by the Action rows and the create form. */
export function ErrorText({ message }: { message: string }) {
  return (
    <p className="text-[length:var(--text-small)] text-destructive" role="alert">
      {message}
    </p>
  );
}

/**
 * The calm timeliness cue for an Action. Clay accent (never red) marks what's due
 * now; a quiet muted line covers upcoming and unscheduled; a deferred Action reads
 * as deliberately "Set aside until …" with a moon, not a warning. Always a word,
 * never color alone (DESIGN.md §3, §6; ADR 0149).
 */
export function ActionDueChip({
  surfaceState,
  surfaceLabel,
}: {
  surfaceState: ActionSurfaceState;
  surfaceLabel: string;
}) {
  if (surfaceState === "deferred") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[length:var(--text-caption)] text-muted-foreground">
        <MoonIcon aria-hidden className="size-3" />
        {surfaceLabel}
      </span>
    );
  }

  if (surfaceState === "upcoming" || surfaceState === "unscheduled") {
    return (
      <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
        {surfaceLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 font-medium text-[length:var(--text-caption)] text-accent-soft-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {surfaceLabel}
    </span>
  );
}
