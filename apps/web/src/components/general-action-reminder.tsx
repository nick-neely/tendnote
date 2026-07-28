"use client";

import type { ReminderScheduleChoice } from "@tendnote/domain/reminders";
import { BellIcon } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";

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
      {relativeOnly ? null : <option value="exact:09:00">At 9:00 AM on the due date</option>}
      <option value="relative:0">{occurrenceLabel}</option>
      {instantRelative ? (
        <option value="relative:60">One hour before the bring-back time</option>
      ) : null}
      <option value="relative:1440">{dayLabel}</option>
      <option value="relative:10080">{weekLabel}</option>
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
        <label className="flex flex-col gap-1.5 text-[length:var(--text-small)] text-muted-foreground">
          Alert time
          <select
            aria-label="Reminder alert time"
            className="h-9 rounded-md border bg-background px-2.5 text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(event) => {
              const [kind, raw] = event.target.value.split(":");
              onChoiceChange(
                kind === "exact"
                  ? { kind: "exact", localTime: raw ?? "09:00" }
                  : { kind: "relative", leadMinutes: Number(raw) },
              );
            }}
            value={value}
          >
            <ReminderAlertOptions instantRelative={instantRelative} relativeOnly={relativeOnly} />
          </select>
          <span>
            One alert. Changing the {instantRelative ? "bring-back time" : "due date"} or this
            schedule replaces it.
          </span>
        </label>
      ) : null}
    </div>
  );
}
