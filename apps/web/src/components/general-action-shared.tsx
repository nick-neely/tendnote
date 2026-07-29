import type { PrivacyScope } from "@tendnote/domain";
import Link from "next/link";
import { ASSET_KIND_ICONS } from "@/components/asset-shared";
import { HomeIcon, RepeatIcon, TagIcon, UserIcon, UsersIcon } from "@/components/icons";
import type { GeneralActionLinkedAssetView } from "@/lib/general-action-view";

/** Fallback message when an Action mutation fails for an unknown reason. */
export const GENERIC_ERROR = "That didn't go through. Try again.";

/**
 * A thumb-sized floor for a row control, applied below the `sm` breakpoint.
 *
 * The Action rows use the dense `sm` button (28px), which reads right under a
 * mouse and is too small to hit under a thumb. Rather than grow the control
 * everywhere and coarsen the desktop ledger, every control a finger has to find
 * carries this minimum on phone widths only. Shared so the active, paused, and
 * resolved rows cannot drift apart on it - they did once, and only the active row
 * was reachable.
 */
export const ACTION_CONTROL_TOUCH_TARGET = "max-sm:min-h-11";

/** Inline error line shared by the Action rows and the create form. */
export function ErrorText({ message }: { message: string }) {
  return (
    <p className="text-[length:var(--text-small)] text-destructive" role="alert">
      {message}
    </p>
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
 * The Routine cue: a quiet cadence label ("Every 6 months") with a repeat glyph, so a
 * recurring Action reads as a Routine at a glance (ADR 0148). It states the rhythm,
 * never a streak or a count — calm by default, a missed occurrence is not a failure.
 * The visible chip stays the glyph + cadence (the word "Routine" would be noise once
 * the repeat icon is learned), but the accessible name and hover title spell out
 * "Routine · <cadence>" so the semantics are legible to screen readers and on hover.
 */
export function ActionRoutineChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex w-fit items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[length:var(--text-caption)] text-muted-foreground"
      title={`Routine · ${label}`}
    >
      <RepeatIcon aria-hidden className="size-3 shrink-0" />
      {/* Spell out "Routine" for screen readers; the visible chip stays glyph + cadence. */}
      <span className="sr-only">Routine · </span>
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

/**
 * A hint that grew into a real Asset (#199): the chip becomes a quiet deep link
 * into the Asset Profile, named and glyphed by the Asset itself. Same size as
 * the read-only context chips, but the linked state carries a persistent cue —
 * ink-colored name with an always-on underline — so a real Asset reads as
 * navigable at rest, not only on hover (touch has no hover).
 */
export function ActionLinkedAssetChip({ asset }: { asset: GeneralActionLinkedAssetView }) {
  const Icon = ASSET_KIND_ICONS[asset.kind];
  return (
    <Link
      className="inline-flex max-w-[24ch] items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[length:var(--text-caption)] text-muted-foreground transition-colors hover:border-primary/45 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      href={`/assets/${asset.assetId}`}
      title={`${asset.kindLabel} · ${asset.name}`}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground/60">
        {asset.name}
      </span>
    </Link>
  );
}

/**
 * A hint whose promotion is still in the Review Queue (#199): the hint chip with
 * a quiet "in review" word — state by text, never color alone — so the owner
 * knows it's on its way without being nagged to go accept it.
 */
export function ActionPendingAssetChip({ label }: { label: string }) {
  return (
    <span className="inline-flex max-w-[28ch] items-center gap-1 rounded-md border border-dashed border-border bg-card px-2 py-0.5 text-[length:var(--text-caption)] text-muted-foreground">
      <TagIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-muted-foreground/80">· in review</span>
    </span>
  );
}
