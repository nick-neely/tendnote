"use client";

import { useReminderInstallation } from "@/components/reminder-installation-context";
import { ReminderOptInInvitation } from "@/components/reminder-opt-in-invitation";

export function ReminderOptInOfferPresenter() {
  const installation = useReminderInstallation();
  if (!installation?.reminderOptInOffered) return null;
  return (
    <ReminderOptInInvitation
      clientInstallationId={installation.clientInstallationId}
      onDismiss={installation.dismissReminderOptIn}
    />
  );
}
