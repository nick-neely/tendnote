"use client";

import type { ReminderScheduleChoice } from "@tendnote/domain/reminders";
import { BellIcon } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type GeneralActionReminderChoice = ReminderScheduleChoice;

function ReminderAlertOptions({
  exactLocalTime,
  instantRelative,
  relativeOnly,
}: {
  exactLocalTime: string;
  instantRelative: boolean;
  relativeOnly: boolean;
}) {
  const occurrenceLabel = instantRelative
    ? "At the bring-back time"
    : "On the occurrence day at 9:00 AM";
  const dayLabel = instantRelative
    ? "One day before at the same time"
    : "One day before at 9:00 AM";
  const weekLabel = instantRelative
    ? "One week before at the same time"
    : "One week before at 9:00 AM";
  return (
    <>
      {relativeOnly ? null : (
        <SelectItem value="exact">
          At {formatExactLocalTime(exactLocalTime)} on the due date
        </SelectItem>
      )}
      <SelectItem value="relative:0">{occurrenceLabel}</SelectItem>
      {instantRelative ? (
        <SelectItem value="relative:60">One hour before the bring-back time</SelectItem>
      ) : null}
      <SelectItem value="relative:1440">{dayLabel}</SelectItem>
      <SelectItem value="relative:10080">{weekLabel}</SelectItem>
    </>
  );
}

function formatExactLocalTime(localTime: string) {
  const [hour, minute] = localTime.split(":").map(Number) as [number, number];
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${period}`;
}

/**
 * The alert-time choice on its own, without the enclosing "Remind me" opt-in.
 *
 * Split out because a surface can arrive already committed to setting a reminder
 * — the Responsibility Holder's one-time offer answers the yes/no in prose and in
 * its own buttons — and reusing the whole field there would leave a checkbox that
 * says the same thing twice and cannot honestly be unchecked. Both surfaces share
 * this so the alert-time vocabulary and its one-alert promise never drift.
 */
export function ReminderAlertTimeField({
  allowCustomExactTime = false,
  choice,
  relativeOnly = false,
  instantRelative = false,
  onChoiceChange,
}: {
  allowCustomExactTime?: boolean;
  choice: GeneralActionReminderChoice;
  relativeOnly?: boolean;
  instantRelative?: boolean;
  onChoiceChange: (choice: GeneralActionReminderChoice) => void;
}) {
  const value = choice.kind === "exact" ? "exact" : `relative:${choice.leadMinutes}`;
  return (
    // The caption is a plain span, not a label: the trigger is a button carrying its
    // own accessible name, so a wrapping label would only add a second click target.
    <div className="flex flex-col gap-1.5 text-[length:var(--text-small)] text-muted-foreground">
      Alert time
      <Select
        onValueChange={(next) => {
          // Relative choices carry their lead after a colon. Exact uses a stable
          // option identity so editing its time cannot make Radix select a fallback.
          const separator = next.indexOf(":");
          const kind = separator === -1 ? next : next.slice(0, separator);
          const raw = separator === -1 ? "" : next.slice(separator + 1);
          onChoiceChange(
            kind === "exact"
              ? {
                  kind: "exact",
                  localTime: choice.kind === "exact" ? choice.localTime : raw || "09:00",
                }
              : { kind: "relative", leadMinutes: Number(raw) },
          );
        }}
        value={value}
      >
        <SelectTrigger aria-label="Reminder alert time" className="w-full text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <ReminderAlertOptions
            exactLocalTime={choice.kind === "exact" ? choice.localTime : "09:00"}
            instantRelative={instantRelative}
            relativeOnly={relativeOnly}
          />
        </SelectContent>
      </Select>
      {allowCustomExactTime && choice.kind === "exact" ? (
        <Input
          aria-label="Exact reminder time"
          className="w-full text-foreground sm:w-40"
          onChange={(event) => {
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(event.target.value)) {
              onChoiceChange({ kind: "exact", localTime: event.target.value });
            }
          }}
          type="time"
          value={choice.localTime}
        />
      ) : null}
      <span>
        One alert. Changing the {instantRelative ? "bring-back time" : "due date"} or this schedule
        replaces it.
      </span>
    </div>
  );
}

export function GeneralActionReminderField({
  allowCustomExactTime = false,
  enabled,
  choice,
  relativeOnly = false,
  instantRelative = false,
  onEnabledChange,
  onChoiceChange,
}: {
  allowCustomExactTime?: boolean;
  enabled: boolean;
  choice: GeneralActionReminderChoice;
  relativeOnly?: boolean;
  instantRelative?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onChoiceChange: (choice: GeneralActionReminderChoice) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
      <div className="flex items-center gap-2 text-[length:var(--text-small)] font-medium">
        <Checkbox
          aria-label="Remind me"
          checked={enabled}
          onCheckedChange={(value) => {
            const nextEnabled = value === true;
            if (nextEnabled && relativeOnly && choice.kind === "exact") {
              onChoiceChange({ kind: "relative", leadMinutes: 0 });
            }
            onEnabledChange(nextEnabled);
          }}
        />
        <BellIcon className="size-3.5 text-muted-foreground" />
        Remind me
      </div>
      {enabled ? (
        <ReminderAlertTimeField
          allowCustomExactTime={allowCustomExactTime}
          choice={choice}
          instantRelative={instantRelative}
          onChoiceChange={onChoiceChange}
          relativeOnly={relativeOnly}
        />
      ) : null}
    </div>
  );
}
