import type { ReactNode } from "react";
import { CARD_TONE, type CardTone } from "@/components/assistant-result-card";
import { ChevronDownIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * The two read-only presentational shells shared across result modules: the quiet
 * ambient line (a lookup that happened, kept out of the way) and the collapsible
 * disclosure (a non-empty result set behind a one-line summary). Every module's
 * line/disclosure render composes these, so the shared chrome — the border, the
 * summary row, the fade-in — lives in exactly one place while each module supplies
 * only its icon, summary text, and body.
 */

/** Quiet ambient row: an Eve lookup that happened, kept out of the way. */
export function ToolActivityLine({
  icon,
  children,
  isNew,
}: {
  icon: ReactNode;
  children: ReactNode;
  isNew: boolean;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]",
        isNew && "fade-in animate-in duration-200 ease-(--motion-ease-out)",
      )}
    >
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * The collapsible `<details>` chrome shared by every disclosure — the read-only
 * result-set disclosures (a search, an agenda, a ledger) and the collapsed group of
 * same-kind durable saves. It owns the one skeleton: the fade-in `<details>`, the
 * summary row (icon + one-line summary + chevron), and the expanded body, so that
 * markup lives in exactly one place. Callers vary only three things:
 *
 * - `size` — `"sm"` (a lean bg-card disclosure, the default) or `"lg"` (the roomier,
 *   trust-toned group card);
 * - `tone` — a {@link CardTone} surface for the group, so the fold reads its trust at
 *   a glance; absent for the plain disclosures;
 * - `footer` — the group's trust caption below the rows; the plain disclosures omit it.
 *
 * `icon` and `summary` are rendered verbatim (the group passes a chip-wrapped icon
 * and a tone-colored label), so each surface keeps its own look through one shell.
 */
export function DisclosureShell({
  icon,
  summary,
  toolView,
  isNew,
  children,
  tone,
  size = "sm",
  footer,
}: {
  icon: ReactNode;
  summary: ReactNode;
  toolView: string;
  isNew: boolean;
  children: ReactNode;
  tone?: CardTone;
  size?: "sm" | "lg";
  footer?: ReactNode;
}) {
  const toneStyle = tone ? CARD_TONE[tone] : null;
  return (
    <details
      className={cn(
        "group [&[open]_.tn-chevron]:rotate-180",
        size === "lg" ? "rounded-xl" : "rounded-lg",
        toneStyle ? cn("border", toneStyle.surface) : "border bg-card",
        isNew && "fade-in slide-in-from-bottom-1 animate-in duration-200 ease-(--motion-ease-out)",
      )}
      data-tool-view={toolView}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
          size === "lg"
            ? "gap-2 rounded-xl p-3"
            : "gap-1.5 rounded-lg p-3.5 text-[length:var(--text-small)] text-muted-foreground hover:text-foreground",
        )}
      >
        {icon}
        {summary}
        <ChevronDownIcon
          aria-hidden
          className="tn-chevron ml-auto size-3.5 shrink-0 transition-transform duration-200 ease-(--motion-ease-out)"
        />
      </summary>
      {children}
      {footer ? <div className={cn("border-t px-3 py-2", toneStyle?.divider)}>{footer}</div> : null}
    </details>
  );
}
