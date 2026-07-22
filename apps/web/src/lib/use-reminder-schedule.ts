"use client";

import type { ReminderRecordKind } from "@tendnote/domain/reminders";
import { useState } from "react";
import { clearReminderAction, saveReminderAction } from "@/app/actions/reminders";
import type { GeneralActionReminderChoice } from "@/components/general-action-reminder";
import { getReminderInstallationId } from "@/lib/reminder-registration";
import { type ReminderScheduleView, toReminderScheduleView } from "@/lib/reminder-schedule-view";

function choiceFromSchedule(schedule: ReminderScheduleView | null | undefined) {
  return schedule?.kind === "relative"
    ? ({ kind: "relative", leadMinutes: schedule.leadMinutes ?? 0 } as const)
    : ({ kind: "exact", localTime: schedule?.localTime ?? "09:00" } as const);
}

export function useReminderSchedule(schedule?: ReminderScheduleView | null) {
  const [enabled, setEnabled] = useState(Boolean(schedule));
  const [choice, setChoice] = useState<GeneralActionReminderChoice>(() =>
    choiceFromSchedule(schedule),
  );

  function reset(next?: ReminderScheduleView | null) {
    setEnabled(Boolean(next));
    setChoice(choiceFromSchedule(next));
  }

  async function save(
    recordKind: ReminderRecordKind,
    recordId: string,
    timeSemantics: "date_only" | "instant" = "date_only",
  ) {
    const clientInstallationId = getReminderInstallationId(window.localStorage);
    const result = await saveReminderAction({
      recordKind,
      recordId,
      clientInstallationId,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      schedule: choice,
    });
    return {
      ...result,
      clientInstallationId,
      scheduleView: toReminderScheduleView(result.schedule, timeSemantics),
    };
  }

  async function clear(recordKind: ReminderRecordKind, recordId: string) {
    await clearReminderAction({ recordKind, recordId });
  }

  return { choice, clear, enabled, reset, save, setChoice, setEnabled };
}
