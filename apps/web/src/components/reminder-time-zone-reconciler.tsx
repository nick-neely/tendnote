"use client";

import { useEffect } from "react";
import { reconcileReminderTimeZoneAction } from "@/app/actions/reminders";
import { useReminderInstallation } from "@/components/reminder-installation-context";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";

const REMINDER_TIME_ZONE_KEY = "tendnote.reminder-time-zone";

function currentTimeZoneFingerprint(timeZone: string) {
  return `${timeZone}|utc-offset-minutes:${new Date().getTimezoneOffset()}`;
}

export function ReminderTimeZoneReconciler() {
  const installation = useReminderInstallation();
  useEffect(() => {
    const timeZone = installation?.timeZone;
    if (!timeZone) return;
    const resolvedTimeZone = timeZone;
    const fingerprint = currentTimeZoneFingerprint(resolvedTimeZone);
    if (window.localStorage.getItem(REMINDER_TIME_ZONE_KEY) === fingerprint) return;
    let cancelled = false;
    async function reconcileAll(offset = 0): Promise<void> {
      const result = unwrapOwnerActionResult(
        await reconcileReminderTimeZoneAction({
          timeZone: resolvedTimeZone,
          ...(offset ? { offset } : {}),
        }),
      );
      if (!cancelled && result.remaining > 0) {
        await reconcileAll(result.nextOffset);
      }
    }
    void reconcileAll()
      .then(() => {
        if (!cancelled) window.localStorage.setItem(REMINDER_TIME_ZONE_KEY, fingerprint);
      })
      .catch(() => {
        // Keep the old value so the next app load retries authoritative regeneration.
      });
    return () => {
      cancelled = true;
    };
  }, [installation?.timeZone]);

  return null;
}
