"use client";

import { useEffect } from "react";
import { reconcileReminderTimeZoneAction } from "@/app/actions/reminders";

const REMINDER_TIME_ZONE_KEY = "tendnote.reminder-time-zone";

function currentTimeZoneFingerprint(timeZone: string) {
  return `${timeZone}|utc-offset-minutes:${new Date().getTimezoneOffset()}`;
}

export function ReminderTimeZoneReconciler() {
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return;
    const fingerprint = currentTimeZoneFingerprint(timeZone);
    if (window.localStorage.getItem(REMINDER_TIME_ZONE_KEY) === fingerprint) return;
    let cancelled = false;
    void reconcileReminderTimeZoneAction({ timeZone })
      .then(() => {
        if (!cancelled) window.localStorage.setItem(REMINDER_TIME_ZONE_KEY, fingerprint);
      })
      .catch(() => {
        // Keep the old value so the next app load retries authoritative regeneration.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
