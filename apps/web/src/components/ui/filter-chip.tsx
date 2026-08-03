"use client";

import type { ReactNode } from "react";
import { ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * One option of a single-select filter strip - the Areas row on Actions, the
 * record-type row on mobile Search.
 *
 * Built on the shared `ToggleGroupItem` rather than a hand-rolled `aria-pressed`
 * button: the options are mutually exclusive, so Radix's single-select group is
 * the honest semantic (a radio group, arrow-key traversable, one tab stop for the
 * whole row) and the toggle variants carry the resting outline treatment.
 * Selection is carried by fill *and* `aria-checked` - never color alone
 * (DESIGN.md §8) - and the current selection takes sage, which §3 reserves for
 * exactly this.
 *
 * It lives here rather than beside either caller because the two rows had already
 * drifted apart while claiming to be the same control: one had grown a wider
 * inset and a wrap guard the other lacked. A filter strip is a strip whatever it
 * filters, so there is one of these.
 */
export function FilterChip({
  children,
  className,
  value,
}: {
  children: ReactNode;
  className?: string;
  value: string;
}) {
  return (
    <ToggleGroupItem
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full px-3.5 text-[length:var(--text-small)] max-sm:min-h-11 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:font-medium data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground",
        className,
      )}
      value={value}
    >
      {children}
    </ToggleGroupItem>
  );
}
