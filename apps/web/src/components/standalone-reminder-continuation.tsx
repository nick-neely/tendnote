"use client";

import { useEffect, useState } from "react";
import { claimReminderStandaloneContinuationAction } from "@/app/actions/reminders";
import { useReminderInstallation } from "@/components/reminder-installation-context";
import { ReminderOptInInvitation } from "@/components/reminder-opt-in-invitation";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";
import { isStandaloneReminderContext } from "@/lib/reminder-registration";

export function StandaloneReminderContinuation() {
  const installation = useReminderInstallation();
  const [clientInstallationId, setClientInstallationId] = useState<string | null>(null);

  useEffect(() => {
    if (
      !installation ||
      !isStandaloneReminderContext() ||
      !/iPad|iPhone|iPod/.test(navigator.userAgent)
    )
      return;
    const installationId = installation.clientInstallationId;
    claimReminderStandaloneContinuationAction({ clientInstallationId: installationId })
      .then((result) => {
        if (unwrapOwnerActionResult(result).claimed) {
          setClientInstallationId(installationId);
        }
      })
      .catch(() => undefined);
  }, [installation]);

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
