"use client";

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { getReminderInstallationId } from "@/lib/reminder-registration";

export type ReminderInstallationContextValue = {
  clientInstallationId: string;
  dismissReminderOptIn: () => void;
  offerReminderOptIn: () => void;
  reminderOptInOffered: boolean;
  timeZone: string;
};

export type ReminderInstallationIdentity = Pick<
  ReminderInstallationContextValue,
  "clientInstallationId" | "timeZone"
>;

export function reminderInstallationIdentity(
  value: ReminderInstallationContextValue,
): ReminderInstallationIdentity {
  return {
    clientInstallationId: value.clientInstallationId,
    timeZone: value.timeZone,
  };
}

const ReminderInstallationContext = createContext<ReminderInstallationContextValue | null>(null);

export function ReminderInstallationProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: ReminderInstallationIdentity;
}) {
  const [browserValue, setBrowserValue] = useState<ReminderInstallationIdentity | null>(
    value ?? null,
  );
  const [offerVisible, setOfferVisible] = useState(false);

  useEffect(() => {
    if (value) return;
    setBrowserValue({
      clientInstallationId: getReminderInstallationId(window.localStorage),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }, [value]);

  const identity = value ?? browserValue;
  const contextValue = useMemo(
    () =>
      identity
        ? {
            ...identity,
            dismissReminderOptIn: () => setOfferVisible(false),
            offerReminderOptIn: () => setOfferVisible(true),
            reminderOptInOffered: offerVisible,
          }
        : null,
    [identity, offerVisible],
  );

  return <ReminderInstallationContext value={contextValue}>{children}</ReminderInstallationContext>;
}

export function useReminderInstallation() {
  return useContext(ReminderInstallationContext);
}
