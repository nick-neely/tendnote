"use client";

import type { ReminderRecordKind } from "@tendnote/domain/reminders";
import { useState } from "react";
import { clearReminderAction } from "@/app/actions/reminders";
import type { GeneralActionReminderChoice } from "@/components/general-action-reminder";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";
import { type ReminderScheduleView, toReminderScheduleChoice } from "@/lib/reminder-schedule-view";
import { useReminderScheduleWriter } from "@/lib/use-reminder-schedule-writer";

export function useReminderSchedule(schedule?: ReminderScheduleView | null) {
  const writer = useReminderScheduleWriter();
  const [enabled, setEnabled] = useState(Boolean(schedule));
  const [choice, setChoice] = useState<GeneralActionReminderChoice>(() =>
    toReminderScheduleChoice(schedule),
  );

  function reset(next?: ReminderScheduleView | null) {
    setEnabled(Boolean(next));
    setChoice(toReminderScheduleChoice(next));
  }

  async function save(recordKind: ReminderRecordKind, recordId: string) {
    return writer.save(recordKind, recordId, choice);
  }

  async function clear(recordKind: ReminderRecordKind, recordId: string) {
    unwrapOwnerActionResult(await clearReminderAction({ recordKind, recordId }));
  }

  return { choice, clear, enabled, reset, save, setChoice, setEnabled };
}
