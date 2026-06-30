import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Restrained processing shimmer for transient "thinking" / "working" copy.
 *
 * Two stacked copies of the same text (see `.tn-shimmer*` in globals.css): a
 * solid, always-readable base in `muted-foreground`, and a duplicate in the
 * primary `foreground` ink whose alpha is masked into a band that sweeps across.
 * Because the base layer never goes transparent, the text never fades into the
 * page — it stays AA in both themes — while the overlaid band reads as a calm
 * wave of ink moving through the word. This sidesteps two failure modes at once:
 * the gradient-text ban (each layer is one solid color; only opacity animates)
 * and the light-mode washout of an alpha-only mask (which dims text toward the
 * white page). Tokens flip per theme, so it darkens in light mode and brightens
 * in dark with no theme-specific CSS. Reduced motion drops the band, leaving the
 * static base line. The band is a decorative duplicate, hidden from a11y trees.
 */
export function Shimmer({ className, children, ...props }: ComponentProps<"span">) {
  return (
    <span className={cn("tn-shimmer", className)} {...props}>
      <span className="tn-shimmer-base">{children}</span>
      <span aria-hidden className="tn-shimmer-band">
        {children}
      </span>
    </span>
  );
}
