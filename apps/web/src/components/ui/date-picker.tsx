"use client";

import * as React from "react";
import type { Matcher } from "react-day-picker";

import { CalendarIcon, XIcon } from "@/components/icons";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Date and date-time fields, composed from the already-installed Calendar and
 * Popover. There is no canonical date picker in the shadcn registry - it ships
 * as a documentation example - so this is a first-party composition.
 *
 * The value contract is deliberately identical to the native inputs these
 * replace: `yyyy-mm-dd` for {@link DatePicker}, `yyyy-mm-ddThh:mm` for
 * {@link DateTimePicker}, empty string for "not set". `onChange` hands over the
 * string directly rather than an event, so a call site migrates by dropping
 * `event.target.` and the `type` prop.
 *
 * Both work controlled (`value` + `onChange`) or uncontrolled (`defaultValue`,
 * or nothing at all) - the asset capture form submits its dates through
 * `FormData` with no React state, so `name` renders a hidden input carrying the
 * same string the native field would have posted.
 *
 * One deliberate gap: `required` on {@link DatePicker} maps to `aria-required`
 * only. The trigger is a button, and a `type="hidden"` mirror cannot be
 * validated or focused, so there is no honest way to keep native constraint
 * validation. Call sites that relied on it should gate their submit button.
 * {@link DateTimePicker} keeps native `required` because its time field is a
 * real, visible input.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A `Date` as the `yyyy-mm-dd` string a {@link DatePicker} accepts, in local time. */
export function toDateValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/** A `Date` as the `yyyy-mm-ddThh:mm` string a {@link DateTimePicker} accepts, in local time. */
export function toDateTimeValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${toDateValue(date)}T${hours}:${minutes}`;
}

/**
 * Parse `yyyy-mm-dd` into a local-midnight `Date`. Built from parts rather than
 * `new Date(value)`, which reads a bare date as UTC and lands on the previous
 * day for anyone west of Greenwich.
 */
function parseDateValue(value: string | undefined): Date | undefined {
  const match = value?.match(DATE_PATTERN);
  if (!match) return undefined;

  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** The date half of a `datetime-local` string, and the time half. */
function splitDateTimeValue(value: string): { date: string; time: string } {
  const [date = "", time = ""] = value.split("T");

  return { date, time: time.slice(0, 5) };
}

/**
 * `min`/`max` as day matchers. They have to be separate array entries: a single
 * `{ before, after }` object is an interval matcher and would disable the days
 * *between* the bounds - exactly backwards.
 */
function outOfRangeDays(min: string | undefined, max: string | undefined): Matcher[] | undefined {
  const before = parseDateValue(min);
  const after = parseDateValue(max);
  const matchers: Matcher[] = [];

  if (before) matchers.push({ before });
  if (after) matchers.push({ after });

  return matchers.length ? matchers : undefined;
}

/** Zero-padded `hh:mm` compares correctly as a plain string. Empty bounds are ignored. */
function clampTime(time: string, min: string, max: string): string {
  if (min && time < min) return min;
  if (max && time > max) return max;
  return time;
}

/**
 * Hold the value locally only while the call site does not own it, so one
 * component covers both the controlled forms and the plain `FormData` ones.
 */
function useFieldValue(
  value: string | undefined,
  defaultValue: string | undefined,
  onChange: ((value: string) => void) | undefined,
) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "");
  const isControlled = value !== undefined;

  function commit(next: string) {
    if (!isControlled) setUncontrolled(next);
    onChange?.(next);
  }

  return [isControlled ? value : uncontrolled, commit] as const;
}

/*
 * The trigger is a button dressed as an Input, so a picker sitting beside a text
 * field in the same row lines up to the pixel. Disabled uses explicit muted
 * tokens rather than a 50% fade, which would take the placeholder ink below
 * legibility (DESIGN.md §8).
 */
const dateTriggerClassName =
  "flex w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-left text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-empty:text-muted-foreground md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

/**
 * How tall the control stands. `default` is the 32px every other field in a form
 * row is, so a picker beside an `Input` still lines up. `touch` is the 44px
 * minimum target, for thumb-first surfaces where the picker is the row rather
 * than one field in a dense form - it sizes the time field too, so both halves of
 * a {@link DateTimePicker} stay one control instead of a tall half and a short one.
 */
const dateFieldSizes = {
  default: { trigger: "h-8", time: "" },
  touch: { trigger: "h-11", time: "h-11" },
} as const;

export type DateFieldSize = keyof typeof dateFieldSizes;

/*
 * Clear sits outside the trigger in the DOM - a button inside a button is
 * invalid - and is placed over its right padding.
 */
const clearButtonClassName =
  "absolute inset-y-0 right-1 my-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

type DateFieldOwnProps = {
  /** Show the inline clear control once a date is set. Defaults to `true`. */
  clearable?: boolean;
  /** Initial value when the call site does not control it. */
  defaultValue?: string;
  /** Latest selectable value, same format as `value`. */
  max?: string;
  /** Earliest selectable value, same format as `value`. */
  min?: string;
  /** Posts the value under this key when the field lives in a plain form. */
  name?: string;
  /** Receives the new value string, or `""` when cleared. */
  onChange?: (value: string) => void;
  /** Quiet text shown while nothing is selected. */
  placeholder?: string;
  required?: boolean;
  /** Control height. Defaults to `default` (32px, matching `Input`). */
  size?: DateFieldSize;
  value?: string;
};

export type DatePickerProps = Omit<
  React.ComponentProps<"button">,
  "defaultValue" | "name" | "onChange" | "size" | "type" | "value"
> &
  DateFieldOwnProps;

/**
 * A `yyyy-mm-dd` field. Drop-in for `<Input type="date" />`: pass `id` for label
 * association, `value`/`onChange` for control, `className` for width.
 */
export function DatePicker({
  className,
  clearable = true,
  defaultValue,
  disabled,
  max,
  min,
  name,
  onChange,
  placeholder = "Pick a date",
  required,
  size = "default",
  value,
  ...props
}: DatePickerProps) {
  const [current, commit] = useFieldValue(value, defaultValue, onChange);
  const [open, setOpen] = React.useState(false);

  const selected = parseDateValue(current);
  const showClear = clearable && Boolean(current) && !disabled;

  return (
    <div className={cn("relative w-full min-w-0", className)} data-slot="date-picker">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          {/*
           * `combobox` rather than the implicit `button` role: this control
           * holds a value and expands a chooser, which is what assistive tech
           * needs to hear, and it is the role Radix's own Select trigger takes.
           * It also makes `aria-required` valid here - `button` does not
           * support it. Radix supplies `aria-controls` and
           * `aria-haspopup="dialog"` on top; `aria-expanded` is spelled out
           * because the role requires it and this component owns `open`.
           */}
          <button
            aria-expanded={open}
            aria-required={required || undefined}
            className={cn(dateTriggerClassName, dateFieldSizes[size].trigger, showClear && "pr-8")}
            data-empty={current ? undefined : ""}
            data-slot="date-picker-trigger"
            disabled={disabled}
            role="combobox"
            type="button"
            {...props}
          >
            <CalendarIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {selected ? formatDateLabel(selected) : placeholder}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            autoFocus
            defaultMonth={selected}
            disabled={outOfRangeDays(min, max)}
            endMonth={parseDateValue(max)}
            mode="single"
            onSelect={(next) => {
              // Re-picking the selected day is a confirmation, never a clear -
              // clearing belongs to the explicit control.
              if (next) commit(toDateValue(next));
              setOpen(false);
            }}
            selected={selected}
            startMonth={parseDateValue(min)}
          />
        </PopoverContent>
      </Popover>
      {showClear ? (
        <button
          aria-label="Clear date"
          className={clearButtonClassName}
          data-slot="date-picker-clear"
          onClick={() => commit("")}
          type="button"
        >
          <XIcon aria-hidden className="size-3.5" />
        </button>
      ) : null}
      {name ? <input name={name} type="hidden" value={current} /> : null}
    </div>
  );
}

export type DateTimePickerProps = DatePickerProps & {
  /** Time applied when a date is picked before a time is. Defaults to `09:00`. */
  defaultTime?: string;
  /** Accessible name for the time field. Defaults to `Time`. */
  timeLabel?: string;
};

/**
 * A `yyyy-mm-ddThh:mm` field: the same date trigger plus a time input. Drop-in
 * for `<Input type="datetime-local" />`.
 */
export function DateTimePicker({
  className,
  clearable = true,
  defaultTime = "09:00",
  defaultValue,
  disabled,
  id,
  max,
  min,
  name,
  onChange,
  placeholder = "Pick a date",
  required,
  size = "default",
  timeLabel = "Time",
  value,
  ...props
}: DateTimePickerProps) {
  const [current, commit] = useFieldValue(value, defaultValue, onChange);
  const { date, time } = splitDateTimeValue(current);
  const floor = splitDateTimeValue(min ?? "");
  const ceiling = splitDateTimeValue(max ?? "");

  // Keeps a time the user set before choosing a date, so it survives the trip.
  const [timeDraft, setTimeDraft] = React.useState(time);
  const shownTime = time || timeDraft;

  /*
   * A bound like "not before now" only constrains the time on its own boundary
   * day; every later day is open. Splitting the bound across two controls would
   * otherwise let "today at 09:00" through when the floor is today at 15:00.
   */
  const timeMin = floor.time && date === floor.date ? floor.time : undefined;
  const timeMax = ceiling.time && date === ceiling.date ? ceiling.time : undefined;

  return (
    <div
      className={cn("flex w-full min-w-0 items-center gap-1.5", className)}
      data-slot="date-time-picker"
    >
      <DatePicker
        className="flex-1"
        clearable={clearable}
        disabled={disabled}
        id={id}
        max={ceiling.date}
        min={floor.date}
        onChange={(nextDate) => {
          if (!nextDate) return commit("");
          commit(
            `${nextDate}T${clampTime(
              shownTime || defaultTime,
              nextDate === floor.date ? floor.time : "",
              nextDate === ceiling.date ? ceiling.time : "",
            )}`,
          );
        }}
        placeholder={placeholder}
        required={required}
        size={size}
        value={date}
        {...props}
      />
      <Input
        aria-label={timeLabel}
        className={cn("w-[7.5rem] shrink-0", dateFieldSizes[size].time)}
        disabled={disabled}
        id={id ? `${id}-time` : undefined}
        max={timeMax}
        min={timeMin}
        onChange={(event) => {
          const nextTime = event.target.value;
          setTimeDraft(nextTime);
          // A date-time with half its parts filled is not a value; clearing the
          // time clears the field, exactly as the native control does.
          if (date) commit(nextTime ? `${date}T${nextTime}` : "");
        }}
        required={required}
        type="time"
        value={shownTime}
      />
      {name ? <input name={name} type="hidden" value={current} /> : null}
    </div>
  );
}
