"use client";

import { useEffect, useState } from "react";
import {
  markReminderStandaloneContinuationAction,
  registerReminderInstallationAction,
  setReminderOptInDecisionAction,
} from "@/app/actions/reminders";
import { BellRingIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";
import {
  attemptReminderRegistration,
  detectReminderCapability,
  isStandaloneReminderContext,
  type ReminderRegistrationOutcome,
} from "@/lib/reminder-registration";

function outcomeMessage(outcome: ReminderRegistrationOutcome | null) {
  if (outcome?.status === "enabled") return "Reminders are enabled on this installation.";
  if (outcome?.status === "denied")
    return "Notifications are blocked. You can allow them later in browser settings.";
  if (outcome?.status === "postponed") return "Tendnote will wait before asking again.";
  if (outcome?.status === "install_required")
    return "Add Tendnote to your Home Screen before enabling reminders on iPhone or iPad.";
  if (outcome?.status === "unsupported")
    return "This browser can't deliver reminders. On iPhone, add Tendnote to your Home Screen first.";
  if (outcome?.status === "registration_failed")
    return "You allowed notifications, but Tendnote couldn't finish setting them up. Try again.";
  return null;
}

type ReminderCapability = "supported" | "unsupported" | "install_required" | null;
type PendingReminderAction = "enable" | "postpone" | null;

function useReminderOptIn(clientInstallationId: string, onDismiss: () => void) {
  const [pendingAction, setPendingAction] = useState<PendingReminderAction>(null);
  const [outcome, setOutcome] = useState<ReminderRegistrationOutcome | null>(null);
  const [capability, setCapability] = useState<ReminderCapability>(null);

  useEffect(() => {
    const standalone = isStandaloneReminderContext();
    const detected = detectReminderCapability({
      userAgent: navigator.userAgent,
      standalone,
      notificationSupported: "Notification" in window,
      serviceWorkerSupported: "serviceWorker" in navigator,
      pushSupported: "PushManager" in window,
    });
    setCapability(detected);
    if (detected === "install_required") {
      void markReminderStandaloneContinuationAction({ clientInstallationId }).catch(
        () => undefined,
      );
    }
  }, [clientInstallationId]);

  async function enable() {
    setPendingAction("enable");
    const standalone = isStandaloneReminderContext();
    const result = await attemptReminderRegistration({
      clientInstallationId,
      publicKey: process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? "",
      userAgent: navigator.userAgent,
      standalone,
      notification: "Notification" in window ? Notification : null,
      serviceWorker: "serviceWorker" in navigator ? navigator.serviceWorker : null,
      pushSupported: "PushManager" in window,
      register: async (input) =>
        unwrapOwnerActionResult(await registerReminderInstallationAction(input)),
      decide: async (decision) =>
        unwrapOwnerActionResult(
          await setReminderOptInDecisionAction({ clientInstallationId, decision }),
        ),
    });
    setOutcome(result);
    try {
      if (result.status === "postponed") onDismiss();
    } finally {
      setPendingAction(null);
    }
  }

  async function postpone() {
    setPendingAction("postpone");
    try {
      unwrapOwnerActionResult(
        await setReminderOptInDecisionAction({
          clientInstallationId,
          decision: "postponed",
        }),
      );
      onDismiss();
    } finally {
      setPendingAction(null);
    }
  }

  return { capability, enable, outcome, pendingAction, postpone };
}

function ReminderCapabilityGuidance({ capability }: { capability: ReminderCapability }) {
  if (capability === "install_required") {
    return (
      <p className="text-[length:var(--text-small)] text-muted-foreground">
        In Safari, tap Share, choose Add to Home Screen, then open Tendnote there to enable
        reminders. Today still works in this browser.
      </p>
    );
  }
  if (capability === "unsupported") {
    return (
      <p className="text-[length:var(--text-small)] text-muted-foreground">
        Reminders don't work in this browser. Check Today instead.
      </p>
    );
  }
  return null;
}

export function ReminderOptInInvitation({
  clientInstallationId,
  onDismiss,
}: {
  clientInstallationId: string;
  onDismiss: () => void;
}) {
  const { capability, enable, outcome, pendingAction, postpone } = useReminderOptIn(
    clientInstallationId,
    onDismiss,
  );
  const message = outcomeMessage(outcome);
  const actionsVisible =
    capability === "supported" && outcome?.status !== "enabled" && outcome?.status !== "denied";

  return (
    <aside className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3.5" role="status">
      <div className="flex items-start gap-3">
        <BellRingIcon className="mt-0.5 size-4 text-primary" />
        <div className="flex flex-1 flex-col gap-2">
          <div>
            <p className="text-sm font-medium">Get this reminder on this installation?</p>
            <p className="text-[length:var(--text-small)] text-muted-foreground">
              Alerts show generic text on your lock screen, and your browser won't ask for
              permission until you choose Enable. Delivery isn't guaranteed, and you can turn
              reminders off anytime.
            </p>
          </div>
          {message ? (
            <p className="text-[length:var(--text-small)] text-muted-foreground">{message}</p>
          ) : null}
          <ReminderCapabilityGuidance capability={capability} />
          {actionsVisible ? (
            <div className="flex flex-wrap gap-2">
              <Button disabled={pendingAction !== null} onClick={enable} size="sm" type="button">
                {pendingAction === "enable" ? <Spinner /> : null}
                {pendingAction === "enable"
                  ? "Enabling…"
                  : outcome?.status === "registration_failed"
                    ? "Try again"
                    : "Enable reminders"}
              </Button>
              <Button
                disabled={pendingAction !== null}
                onClick={postpone}
                size="sm"
                type="button"
                variant="ghost"
              >
                {pendingAction === "postpone" ? <Spinner /> : null}
                {pendingAction === "postpone" ? "Saving…" : "Not now"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
