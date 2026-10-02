"use client";

import { cn } from "@tendnote/ui/cn";
import { useState } from "react";
import { approximateFullQualityTurns, FAIR_USE, formatDollars } from "@/lib/offer";

/*
 * Fair Use's one authored moment: one Usage Period of Eve, stepped through by
 * hand. The marker rides the month's spend, the notice beside it is the one a
 * customer would see in the composer, and on reset day the fill runs back to
 * empty. Nothing advances on a timer; every state is a button away. The reset
 * date is an example, labelled as one.
 */

const EXAMPLE_RESET = "November 14";
const BUDGET_SHARE = FAIR_USE.eveBudget / FAIR_USE.eveCeiling;

type Stage = {
  id: string;
  label: string;
  /** Where the month's Eve spend sits, as a share of the limit. */
  fill: number;
  eve: string;
  notice: string | null;
};

function stages(turns: number): readonly Stage[] {
  return [
    {
      id: "normal",
      label: "Most months",
      fill: 0.42,
      eve: "Full quality",
      notice: null,
    },
    {
      id: "reduced",
      label: `Past about ${turns} turns`,
      fill: BUDGET_SHARE + (1 - BUDGET_SHARE) * 0.45,
      eve: "Lighter model",
      notice: `Eve is using a lighter model for the rest of this month. Resets on ${EXAMPLE_RESET}.`,
    },
    {
      id: "paused",
      label: "At the monthly limit",
      fill: 1,
      eve: "Paused, no new turns",
      notice: `Eve is paused until your monthly limit resets. Resets on ${EXAMPLE_RESET}.`,
    },
    {
      id: "reset",
      label: "Reset day",
      fill: 0,
      eve: "Full quality",
      notice: null,
    },
  ];
}

const alwaysOn = ["Your notes and people", "Reminders", "Export", "Billing and cancelling"];

export function MonthMeter() {
  const turns = approximateFullQualityTurns();
  const all = stages(turns);
  const [index, setIndex] = useState(0);
  const stage = all[index] as Stage;

  return (
    <div className="flex flex-col gap-6 rounded-2xl border bg-background p-5 sm:p-7">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-semibold">One month of Eve</legend>
        <div className="flex flex-wrap gap-2">
          {all.map((option, optionIndex) => (
            <button
              aria-pressed={optionIndex === index}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium outline-none transition-[color,background-color,border-color] duration-200 focus-visible:ring-3 focus-visible:ring-ring",
                optionIndex === index
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
              key={option.id}
              onClick={() => setIndex(optionIndex)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div aria-hidden className="flex flex-col gap-2">
        <div className="relative h-3 overflow-hidden rounded-full bg-muted">
          <span
            className="absolute inset-y-0 left-0 bg-primary/25"
            style={{ width: `${BUDGET_SHARE * 100}%` }}
          />
          <span
            className="absolute inset-y-0 right-0 left-auto bg-accent/20"
            style={{ width: `${(1 - BUDGET_SHARE) * 100}%` }}
          />
          <span
            className={cn(
              "absolute inset-y-0 left-0 origin-left rounded-full transition-[transform,background-color] duration-700 ease-(--motion-ease-out)",
              stage.fill > BUDGET_SHARE ? "bg-accent" : "bg-primary",
            )}
            style={{ width: "100%", transform: `scaleX(${stage.fill})` }}
          />
        </div>
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            Full quality, about {turns} turns ({formatDollars(FAIR_USE.eveBudget)})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-accent" />
            Lighter model, to the {formatDollars(FAIR_USE.eveCeiling)} limit
          </span>
        </div>
      </div>

      <div aria-live="polite" className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Eve: <span className="font-semibold text-foreground">{stage.eve}</span>
          </p>
          <div
            className="tn-rise rounded-xl border bg-surface px-3.5 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)]"
            key={stage.id}
          >
            {stage.notice ?? (
              <span className="text-muted-foreground">No notice. Eve works as usual.</span>
            )}
          </div>
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          <li className="text-muted-foreground">Still working, whatever the meter says:</li>
          {alwaysOn.map((item) => (
            <li className="flex items-center gap-2" key={item}>
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        An example month. Your notices show your own reset date.
      </p>
    </div>
  );
}
