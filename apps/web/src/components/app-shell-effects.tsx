"use client";

import { useEffect, useState } from "react";
import { MobileFailureState } from "@/components/mobile-failure-state";
import { PwaRegistration } from "@/components/pwa-registration";
import { ReminderOptInOfferPresenter } from "@/components/reminder-opt-in-offer-presenter";
import { ReminderTimeZoneReconciler } from "@/components/reminder-time-zone-reconciler";
import { StandaloneReminderContinuation } from "@/components/standalone-reminder-continuation";
import { useDeepLinkHighlight } from "@/lib/use-deep-link-highlight";

/** Client-only lifecycle and connectivity effects; navigation stays server-rendered. */
export function AppShellEffects() {
  const online = useOnlineState();
  useDeepLinkHighlight();

  return (
    <>
      <PwaRegistration />
      <ReminderTimeZoneReconciler />
      <StandaloneReminderContinuation />
      <ReminderOptInOfferPresenter />
      {!online ? (
        <div className="px-4 pt-[calc(1rem+env(safe-area-inset-top))] lg:pt-4">
          <MobileFailureState kind="offline" onRetry={() => window.location.reload()} />
        </div>
      ) : null}
    </>
  );
}

function useOnlineState() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
