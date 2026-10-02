"use client";

import { cn } from "@tendnote/ui/cn";

export type StoryStep = { id: string; title: string; body: string };

const smallMuted =
  "text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground";

/**
 * The steps of a Sam story as buttons, so the keyboard reaches every state.
 * The full list rules a line beside each title and opens the live step's body;
 * the compact form is a row of bars with the live step's words beneath, for
 * phones.
 */
export function StorySteps({
  className,
  compact = false,
  current,
  label,
  onSelect,
  steps,
}: {
  className?: string;
  compact?: boolean;
  current: number;
  label: string;
  onSelect: (index: number) => void;
  steps: readonly StoryStep[];
}) {
  if (compact) {
    const live = steps[Math.min(current, steps.length - 1)] as StoryStep;
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <ol aria-label={label} className="flex gap-1.5">
          {steps.map((step, index) => (
            <li className="flex-1" key={step.id}>
              <button
                aria-current={index === current ? "step" : undefined}
                aria-label={step.title}
                className="block w-full rounded-full py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring"
                onClick={() => onSelect(index)}
                type="button"
              >
                <span
                  className={cn(
                    "block h-1 rounded-full transition-colors duration-300",
                    index <= current ? "bg-primary" : "bg-border",
                  )}
                />
              </button>
            </li>
          ))}
        </ol>
        <div className="tn-rise flex flex-col gap-1" key={live.id}>
          <p className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
            {live.title}
          </p>
          <p className={smallMuted}>{live.body}</p>
        </div>
      </div>
    );
  }

  return (
    <ol aria-label={label} className={cn("flex flex-col", className)}>
      {steps.map((step, index) => {
        const active = index === current;
        return (
          <li className="relative pl-5" key={step.id}>
            <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-border" />
            <span
              aria-hidden
              className={cn(
                "absolute inset-y-0 left-0 w-px origin-top bg-primary transition-transform duration-500 ease-(--motion-ease-out)",
                active ? "scale-y-100" : "scale-y-0",
              )}
            />
            <button
              aria-current={active ? "step" : undefined}
              className="block w-full rounded-sm py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
              onClick={() => onSelect(index)}
              type="button"
            >
              <span
                className={cn(
                  "block text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium transition-colors duration-300",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.title}
              </span>
              <span
                className={cn(
                  "grid transition-[grid-template-rows] duration-400 ease-(--motion-ease-out)",
                  active ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <span className="block overflow-hidden">
                  <span
                    className={cn(
                      "block max-w-[44ch] pt-1 pb-1 transition-opacity duration-300",
                      smallMuted,
                      active ? "opacity-100" : "opacity-0",
                    )}
                  >
                    {step.body}
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
