import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Restrained loading shimmer for transient "thinking" / "working" copy. A light
 * band sweeps across the text's alpha via a CSS mask (see `.tn-shimmer` in
 * globals.css), so the text keeps its solid color — no banned gradient text —
 * and honors prefers-reduced-motion (mask + animation drop to a static line).
 */
export function Shimmer({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("tn-shimmer", className)} {...props} />;
}
