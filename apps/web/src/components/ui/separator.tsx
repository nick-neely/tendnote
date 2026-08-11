"use client";

import { Separator as SeparatorPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The vertical rule centers instead of stretching, which is the one departure
 * from the registry default.
 *
 * shadcn ships `data-vertical:self-stretch` so a vertical separator fills its
 * flex row without being given a height. Every vertical call site here gives it
 * one anyway, because the intent is a short rule standing between controls, not
 * a full-height column - and `align-self: stretch` on an item with a definite
 * cross size behaves as flex-start, so those rules hung from the top of their
 * row rather than sitting in the middle of it.
 *
 * The correction has to live here, not at the call sites. `data-vertical` is a
 * `:where()` variant, so it adds no specificity, but Tailwind emits variant
 * utilities after plain ones: a call-site `self-center` loses the cascade and
 * silently does nothing. A separator that really does want to fill its row says
 * `data-vertical:self-stretch`, which tailwind-merge resolves against this one.
 */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-center",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
