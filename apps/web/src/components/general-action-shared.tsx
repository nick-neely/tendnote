import type { PrivacyScope } from "@tendnote/domain";
import { HomeIcon, MoonIcon, TagIcon, UserIcon, UsersIcon } from "lucide-react";
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

/**
 * A quiet visibility indicator for a shared or household Action. Scope is conveyed by
 * icon *and* word, never color — a private Action carries no indicator at all so the
 * private-first surface stays uncluttered (DESIGN.md §8; ADR 0153).
 */
export function ActionScopeChip({ scope, label }: { scope: PrivacyScope; label: string }) {
  if (scope === "private") {
    return null;
  }
  const Icon = scope === "household" ? HomeIcon : UsersIcon;

  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[length:var(--text-caption)] text-muted-foreground">
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}

/**
 * A quiet, read-only chip for an Action's linked person or asset hint — context the
 * surface shows without pulling attention. A linked person is context, never a
 * Follow-Up (ADR 0155); an asset hint is a label, never a record (ADR 0156).
 */
export function ActionContextChip({
  kind,
  children,
}: {
  kind: "person" | "asset";
  children: React.ReactNode;
}) {
  const Icon = kind === "person" ? UserIcon : TagIcon;

  return (
    <span className="inline-flex max-w-[24ch] items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[length:var(--text-caption)] text-muted-foreground">
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}
