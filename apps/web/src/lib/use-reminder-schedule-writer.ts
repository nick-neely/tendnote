"use client";

import {
  type ReminderRecordKind,
  type ReminderScheduleChoice,
  reminderTimeSemanticsForRecordKind,
} from "@tendnote/domain/reminders";
import { saveReminderAction } from "@/app/actions/reminders";
import {
  reminderInstallationIdentity,
  useReminderInstallation,
} from "@/components/reminder-installation-context";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";

export function useReminderScheduleWriter() {
  const installation = useReminderInstallation();

  async function save(
    recordKind: ReminderRecordKind,
    recordId: string,
    schedule: ReminderScheduleChoice,
  ) {
    if (!installation) {
      throw new Error("Reminder installation identity is still loading.");
    }
    const result = unwrapOwnerActionResult(
      await saveReminderAction({
        recordKind,
        recordId,
        ...reminderInstallationIdentity(installation),
        schedule,
      }),
    );
    if (result.optIn.state === "offer") installation.offerReminderOptIn();
    return {
      ...result,
      clientInstallationId: installation.clientInstallationId,
      scheduleView: toReminderScheduleView(
        result.schedule,
        reminderTimeSemanticsForRecordKind(recordKind),
      ),
    };
  }

  return { installation, save };
}
