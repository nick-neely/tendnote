import type * as React from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/**
 * The one empty-state treatment for the product.
 *
 * The app had grown three of these - a dashed box, a bare muted line, and
 * nothing at all - so this settles on the dashed box, which is the form that
 * already reads as "a place where something will live" rather than a broken
 * section. Structure follows DESIGN.md §6: a `title` that names the absence in
 * plain words, an optional `description` that teaches the next step, and an
 * optional `action`. No guilt copy, no illustration, no count of what is
 * missing.
 *
 * Built on the registry `empty` primitive so the compound parts stay available
 * for the rare surface that needs to break the mould; this wrapper is the
 * default every list, tab, and page should reach for.
 *
 * Typography is the product's small scale rather than the registry's `text-sm`
 * + `tracking-tight`, which would tighten past the -0.02em floor in §4. The
 * title carries full-strength ink on purpose: a lone muted 13px line was the
 * faintest thing on the page, and §8 requires muted text to stay readable.
 */

const emptyStateSizes = {
  /** Full-width sections and pages. */
  default: "gap-2.5 px-4 py-10",
  /** Rail tabs, cards, and other narrow columns. */
  compact: "gap-2 rounded-lg px-3.5 py-5",
} as const;

export type EmptyStateSize = keyof typeof emptyStateSizes;

export function EmptyState({
  action,
  className,
  description,
  size = "default",
  title,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  /** Optional next step - a button or link. Rendered under the copy. */
  action?: React.ReactNode;
  /** Optional supporting line. Omit it when the title already says everything. */
  description?: React.ReactNode;
  size?: EmptyStateSize;
  /** Plain statement of what is not here yet. */
  title: React.ReactNode;
}) {
  return (
    <Empty
      data-slot="empty-state"
      data-size={size}
      className={cn("flex-none border border-dashed bg-surface", emptyStateSizes[size], className)}
      {...props}
    >
      <EmptyHeader className={cn("gap-1", size === "compact" && "max-w-none")}>
        <EmptyTitle className="text-[length:var(--text-small)] font-medium tracking-normal text-foreground leading-[var(--text-small-line)]">
          {title}
        </EmptyTitle>
        {description ? (
          <EmptyDescription className="text-[length:var(--text-small)] leading-[var(--text-small-line)]">
            {description}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent className="gap-2">{action}</EmptyContent> : null}
    </Empty>
  );
}
