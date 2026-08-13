import type { PrivacyScope } from "@tendnote/domain/privacy";
import { visibilityStatusLabel } from "@tendnote/domain/privacy";
import type { ComponentProps } from "react";
import { EyeIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_CHIP =
  "inline-flex w-fit items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground";

/**
 * Read-only audience status. One eye, one visible sentence, never a tooltip.
 *
 * Ordinary ledgers omit the private default so the page stays uncluttered.
 * Gift Plans pass `privatePolicy="show"` because who is included is the fact
 * the row is for.
 */
export function VisibilityStatus({
  scope,
  selectedCount = 0,
  privatePolicy = "omit",
  className,
}: {
  scope: PrivacyScope;
  selectedCount?: number;
  privatePolicy?: "omit" | "show";
  className?: string;
}) {
  if (scope === "private" && privatePolicy === "omit") {
    return null;
  }

  return (
    <span className={cn(STATUS_CHIP, className)}>
      <EyeIcon aria-hidden className="size-3 shrink-0" />
      {visibilityStatusLabel({ scope, selectedCount })}
    </span>
  );
}

/**
 * The control that opens or commits an audience change. Same eye as the status
 * chip; the visible label is the accessible name. Callers keep size, variant,
 * and placement.
 */
export function VisibilityControl({
  children = "Visibility",
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button {...props}>
      <EyeIcon aria-hidden />
      {children}
    </Button>
  );
}
