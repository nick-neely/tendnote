"use client";

import { useEffect, useState } from "react";
import { claimReminderStandaloneContinuationAction } from "@/app/actions/reminders";
import { ReminderOptInInvitation } from "@/components/general-action-reminder";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";
import {
  getReminderInstallationId,
  isStandaloneReminderContext,
} from "@/lib/reminder-registration";

export function StandaloneReminderContinuation() {
  const [clientInstallationId, setClientInstallationId] = useState<string | null>(null);

  useEffect(() => {
    if (!isStandaloneReminderContext() || !/iPad|iPhone|iPod/.test(navigator.userAgent)) return;
    const installationId = getReminderInstallationId(window.localStorage);
    claimReminderStandaloneContinuationAction({ clientInstallationId: installationId })
      .then((result) => {
        if (unwrapOwnerActionResult(result).claimed) {
          setClientInstallationId(installationId);
        }
      })
      .catch(() => undefined);
  }, []);

  if (!clientInstallationId) return null;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6">
      <ReminderOptInInvitation
        clientInstallationId={clientInstallationId}
        onDismiss={() => setClientInstallationId(null)}
      />
    </div>
  );
}
