"use client";

import type { GeneralActionRecurrence, GeneralActionRecurrenceUnit } from "@tendnote/domain";
import { MAX_RECURRENCE_INTERVAL } from "@tendnote/domain/general-actions";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Radix Select needs a non-empty value, so "one-time" rides a sentinel that maps to
// a null cadence at the boundary — a General Action is one-time until given a cadence.
const NO_CADENCE = "__none__";

// Plural unit words so the control reads as a plain sentence: "every 6 months".
const UNIT_OPTIONS: { value: GeneralActionRecurrenceUnit; label: string }[] = [
  { value: "day", label: "days" },
  { value: "week", label: "weeks" },
  { value: "month", label: "months" },
  { value: "year", label: "years" },
];

/**
 * The cadence control that turns an Action into a Routine (ADR 0148). Off by default —
 * "Doesn't repeat" leads, so the common one-time case costs nothing. Choosing a unit
 * reveals the interval so the whole thing reads as one calm sentence, "every 6 months",
 * never a scheduling engine. SIMPLE recurrence only, matching the domain (ADR 0147).
 */
export function RecurrenceField({
  value,
  onChange,
}: {
  value: GeneralActionRecurrence | null;
  onChange: (recurrence: GeneralActionRecurrence | null) => void;
}) {
  const labelId = useId();
  const interval = value?.interval ?? 1;

  function selectUnit(next: string) {
    if (next === NO_CADENCE) {
      onChange(null);
      return;
    }
    onChange({ interval, unit: next as GeneralActionRecurrenceUnit });
  }

  function setInterval(raw: string) {
    if (!value) {
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    // Keep the field usable mid-edit: clamp to the domain bounds, fall back to 1.
    const clamped = Number.isNaN(parsed)
      ? 1
      : Math.min(Math.max(parsed, 1), MAX_RECURRENCE_INTERVAL);
    onChange({ interval: clamped, unit: value.unit });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[length:var(--text-small)] text-muted-foreground" id={labelId}>
        Repeats
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {value ? (
          <>
            <span className="text-[length:var(--text-small)] text-muted-foreground">every</span>
            <Input
              aria-label="Repeat interval"
              className="w-16"
              inputMode="numeric"
              max={MAX_RECURRENCE_INTERVAL}
              min={1}
              onChange={(event) => setInterval(event.target.value)}
              type="number"
              value={interval}
            />
          </>
        ) : null}
        <Select onValueChange={selectUnit} value={value?.unit ?? NO_CADENCE}>
          <SelectTrigger aria-labelledby={labelId} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CADENCE}>Doesn't repeat</SelectItem>
            {UNIT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
