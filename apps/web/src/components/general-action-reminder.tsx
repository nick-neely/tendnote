"use client";

import type { ReminderScheduleChoice } from "@tendnote/domain/reminders";
import { BellIcon } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type GeneralActionReminderChoice = ReminderScheduleChoice;

function ReminderAlertOptions({
  instantRelative,
  relativeOnly,
}: {
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
        <SelectItem value="exact:09:00">At 9:00 AM on the due date</SelectItem>
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

export function GeneralActionReminderField({
  enabled,
  choice,
  relativeOnly = false,
  instantRelative = false,
  onEnabledChange,
  onChoiceChange,
}: {
  enabled: boolean;
  choice: GeneralActionReminderChoice;
  relativeOnly?: boolean;
  instantRelative?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onChoiceChange: (choice: GeneralActionReminderChoice) => void;
}) {
  const value =
    choice.kind === "exact" ? `exact:${choice.localTime}` : `relative:${choice.leadMinutes}`;
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
        // The caption is a plain span, not a label: the trigger is a button carrying its
        // own accessible name, so a wrapping label would only add a second click target.
        <div className="flex flex-col gap-1.5 text-[length:var(--text-small)] text-muted-foreground">
          Alert time
          <Select
            onValueChange={(next) => {
              // Split on the first colon only: an exact rule's payload is itself an
              // "hh:mm" time, and splitting on every colon truncated it to the hour,
              // which the schedule schema rejects.
              const separator = next.indexOf(":");
              const kind = next.slice(0, separator);
              const raw = next.slice(separator + 1);
              onChoiceChange(
                kind === "exact"
                  ? { kind: "exact", localTime: raw || "09:00" }
                  : { kind: "relative", leadMinutes: Number(raw) },
              );
            }}
            value={value}
          >
            <SelectTrigger aria-label="Reminder alert time" className="w-full text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <ReminderAlertOptions instantRelative={instantRelative} relativeOnly={relativeOnly} />
            </SelectContent>
          </Select>
          <span>
            One alert. Changing the {instantRelative ? "bring-back time" : "due date"} or this
            schedule replaces it.
          </span>
        </div>
      ) : null}
    </div>
  );
}
