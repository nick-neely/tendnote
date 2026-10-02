"use client";

import { Button } from "@tendnote/ui/button";
import { cn } from "@tendnote/ui/cn";
import { useId, useState } from "react";
import { OFFER } from "@/lib/offer";

type Interval = "monthly" | "annual";

const intervals: readonly { id: Interval; label: string }[] = [
  { id: "monthly", label: "Monthly" },
  { id: "annual", label: "Yearly" },
];

/*
 * Pricing's one authored moment: choosing an interval rolls the figure, the
 * way a counter turns over, instead of swapping one number for another. Both
 * figures are always in the DOM; the window shows one. The switch is a native
 * radio group, so arrow keys move between intervals, and a screen reader hears
 * the price from one polite live line rather than the decorative figures.
 */
export function PlanPanel({ subscribeHref }: { subscribeHref: string }) {
  const [interval, setChosen] = useState<Interval>("monthly");
  const name = useId();
  const annual = interval === "annual";

  return (
    <div className="flex flex-col gap-6 rounded-2xl border bg-background p-5 shadow-[0_18px_40px_-28px_rgb(0_0_0/0.35)] sm:p-7 dark:shadow-[0_18px_40px_-28px_rgb(0_0_0/0.9)]">
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Billing interval</legend>
        <div className="grid w-full grid-cols-2 rounded-xl bg-muted p-1 sm:w-fit">
          {intervals.map((option) => (
            <label
              className={cn(
                "relative cursor-pointer rounded-lg px-4 py-2 text-center text-sm font-medium transition-[color,background-color,box-shadow] duration-200 has-focus-visible:ring-3 has-focus-visible:ring-ring",
                interval === option.id
                  ? "bg-background text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.12)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={option.id}
            >
              <input
                checked={interval === option.id}
                className="sr-only"
                name={name}
                onChange={() => setChosen(option.id)}
                type="radio"
                value={option.id}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <p aria-live="polite" className="sr-only">
          {annual ? `$${OFFER.annualPrice} a year` : `$${OFFER.monthlyPrice} a month`}
        </p>
        <div aria-hidden className="flex items-end gap-2">
          <span className="relative block h-[4.5rem] overflow-hidden sm:h-[5.25rem]">
            <span
              className={cn(
                "flex flex-col transition-transform duration-700 ease-(--motion-ease-out)",
                annual ? "-translate-y-1/2" : "translate-y-0",
              )}
            >
              <Figure per="a month" shown={!annual} value={OFFER.monthlyPrice} />
              <Figure per="a year" shown={annual} value={OFFER.annualPrice} />
            </span>
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Plus applicable sales tax.{" "}
          <span
            className={cn(
              "inline-block font-medium text-primary transition-[opacity,filter,transform] duration-500 ease-(--motion-ease-out)",
              annual ? "translate-y-0 opacity-100 blur-0" : "translate-y-1 opacity-0 blur-[2px]",
            )}
          >
            Two months free.
          </span>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Button asChild className="w-full sm:w-fit" size="lg">
          <a href={subscribeHref}>Subscribe</a>
        </Button>
        <p className="max-w-[46ch] text-sm text-muted-foreground">
          You create your account, then pay. You pick monthly or yearly again at checkout, and
          access starts the moment the payment clears.
        </p>
      </div>
    </div>
  );
}

function Figure({ per, shown, value }: { per: string; shown: boolean; value: number }) {
  return (
    <span
      className={cn(
        "flex h-[4.5rem] items-baseline gap-2 transition-opacity duration-500 sm:h-[5.25rem]",
        shown ? "opacity-100" : "opacity-0",
      )}
    >
      <span className="font-display text-[4rem] leading-[4.5rem] font-semibold tabular-nums sm:text-[4.75rem] sm:leading-[5.25rem]">
        ${value}
      </span>
      <span className="text-muted-foreground">{per}</span>
    </span>
  );
}
