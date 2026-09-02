"use client";

import type { ComponentProps } from "react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * AI Elements Suggestion (https://elements.ai-sdk.dev/components/suggestion).
 * A horizontally scrollable row of one-click suggestion chips. Generic and
 * reusable — surfaces decide what each suggestion does on click.
 *
 * Local modifications, per the branch's registry rule:
 * - `Suggestion`'s click handler is wrapped in `useCallback` so a chip does not
 *   take a new identity on every parent render.
 * - `children || suggestion` where upstream writes `children ?? suggestion`: an
 *   empty string is not a label, and `??` would render a chip with no text.
 *
 * The `Suggestions` scroller is deliberately unused by the Assistant surfaces.
 * Its `ScrollBar` is hidden, so a chip clipped at the column edge on a phone
 * reads as broken rather than as scrollable; both the starters and the turn
 * follow-ups wrap instead (`flex flex-wrap gap-2`) and use only `Suggestion`.
 */
export type SuggestionsProps = ComponentProps<typeof ScrollArea>;

export const Suggestions = ({ className, children, ...props }: SuggestionsProps) => (
  <ScrollArea className="w-full overflow-x-auto whitespace-nowrap" {...props}>
    <div className={cn("flex w-max flex-nowrap items-center gap-2", className)}>{children}</div>
    <ScrollBar className="hidden" orientation="horizontal" />
  </ScrollArea>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = "outline",
  size = "sm",
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = useCallback(() => {
    onClick?.(suggestion);
  }, [onClick, suggestion]);

  return (
    <Button
      className={cn("cursor-pointer rounded-full px-4", className)}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children || suggestion}
    </Button>
  );
};
