"use client";

import type { ReminderScheduleChoice } from "@tendnote/domain/reminders";
import { BellIcon, BellRingIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  registerReminderInstallationAction,
  setReminderOptInDecisionAction,
} from "@/app/actions/reminders";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import {
  detectReminderCapability,
  enableReminderRegistration,
  type ReminderRegistrationOutcome,
} from "@/lib/reminder-registration";

export type GeneralActionReminderChoice = ReminderScheduleChoice;

export function GeneralActionReminderField({
  enabled,
  choice,
  onEnabledChange,
  onChoiceChange,
}: {
  enabled: boolean;
  choice: GeneralActionReminderChoice;
  onEnabledChange: (enabled: boolean) => void;
  onChoiceChange: (choice: GeneralActionReminderChoice) => void;
}) {
  const value =
    choice.kind === "exact" ? `exact:${choice.localTime}` : `relative:${choice.leadMinutes}`;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
      <div className="flex items-center gap-2 text-[length:var(--text-small)] font-medium">
        <Checkbox
          aria-label="Remind me"
          checked={enabled}
          onCheckedChange={(value) => onEnabledChange(value === true)}
        />
        <BellIcon className="size-3.5 text-muted-foreground" />
        Remind me
      </div>
      {enabled ? (
        <label className="flex flex-col gap-1.5 text-[length:var(--text-small)] text-muted-foreground">
          Alert time
          <select
            aria-label="Reminder alert time"
            className="h-9 rounded-md border bg-background px-2.5 text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(event) => {
              const [kind, raw] = event.target.value.split(":");
              onChoiceChange(
                kind === "exact"
                  ? { kind: "exact", localTime: raw ?? "09:00" }
                  : { kind: "relative", leadMinutes: Number(raw) },
              );
            }}
            value={value}
          >
            <option value="exact:09:00">At 9:00 AM on the due date</option>
            <option value="relative:1440">One day before at 9:00 AM</option>
            <option value="relative:10080">One week before at 9:00 AM</option>
          </select>
          <span>One alert. Changing the due date or this time replaces it.</span>
        </label>
      ) : null}
    </div>
  );
}

function outcomeMessage(outcome: ReminderRegistrationOutcome | null) {
  if (outcome?.status === "enabled") return "Reminders are enabled on this installation.";
  if (outcome?.status === "denied")
    return "Notifications are blocked. You can allow them later in browser settings.";
  if (outcome?.status === "postponed") return "No problem. Tendnote will wait before asking again.";
  if (outcome?.status === "install_required")
    return "Add Tendnote to your Home Screen before enabling reminders on iPhone or iPad.";
  if (outcome?.status === "unsupported")
    return "This browser cannot register for reminders. On iPhone, install Tendnote to the Home Screen first.";
  if (outcome?.status === "registration_failed")
    return "Permission was allowed, but Tendnote could not register this installation. Try again.";
  return null;
}

type ReminderCapability = "supported" | "unsupported" | "install_required" | null;
type PendingReminderAction = "enable" | "postpone" | null;

function useReminderOptIn(clientInstallationId: string, onDismiss: () => void) {
  const [pendingAction, setPendingAction] = useState<PendingReminderAction>(null);
  const [outcome, setOutcome] = useState<ReminderRegistrationOutcome | null>(null);
  const [capability, setCapability] = useState<ReminderCapability>(null);

  useEffect(() => {
    setCapability(
      detectReminderCapability({
        userAgent: navigator.userAgent,
        standalone:
          window.matchMedia("(display-mode: standalone)").matches ||
          Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
        notificationSupported: "Notification" in window,
        serviceWorkerSupported: "serviceWorker" in navigator,
        pushSupported: "PushManager" in window,
      }),
    );
  }, []);

  async function enable() {
    setPendingAction("enable");
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setOutcome({ status: "unsupported" });
      setPendingAction(null);
      return;
    }
    const result = await enableReminderRegistration({
      publicKey: process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? "",
      notification: Notification,
      serviceWorker: navigator.serviceWorker,
      pushSupported: true,
      register: (subscription) =>
        registerReminderInstallationAction({ clientInstallationId, subscription }),
    });
    setOutcome(result);
    try {
      if (result.status === "denied") {
        await setReminderOptInDecisionAction({ clientInstallationId, decision: "denied" });
      } else if (result.status === "postponed") {
        await setReminderOptInDecisionAction({ clientInstallationId, decision: "postponed" });
        onDismiss();
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function postpone() {
    setPendingAction("postpone");
    try {
      await setReminderOptInDecisionAction({ clientInstallationId, decision: "postponed" });
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
        Add Tendnote to your Home Screen, then open the installed app to enable reminders.
      </p>
    );
  }
  if (capability === "unsupported") {
    return (
      <p className="text-[length:var(--text-small)] text-muted-foreground">
        Reminders are unavailable in this browser.
      </p>
    );
  }
  return null;
}

function ReminderInvitationActions({
  capability,
  onEnable,
  onPostpone,
  outcome,
  pendingAction,
}: {
  capability: ReminderCapability;
  onEnable: () => Promise<void>;
  onPostpone: () => Promise<void>;
  outcome: ReminderRegistrationOutcome | null;
  pendingAction: PendingReminderAction;
}) {
  if (capability !== "supported" || outcome?.status === "enabled" || outcome?.status === "denied") {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button disabled={pendingAction !== null} onClick={onEnable} size="sm" type="button">
        {pendingAction === "enable" ? <Spinner /> : null}
        {pendingAction === "enable" ? "Enabling…" : "Enable reminders"}
      </Button>
      <Button
        disabled={pendingAction !== null}
        onClick={onPostpone}
        size="sm"
        type="button"
        variant="ghost"
      >
        {pendingAction === "postpone" ? <Spinner /> : null}
        {pendingAction === "postpone" ? "Saving…" : "Not now"}
      </Button>
    </div>
  );
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

  return (
    <aside className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3.5" role="status">
      <div className="flex items-start gap-3">
        <BellRingIcon className="mt-0.5 size-4 text-primary" />
        <div className="flex flex-1 flex-col gap-2">
          <div>
            <p className="text-sm font-medium">Get this reminder on this installation?</p>
            <p className="text-[length:var(--text-small)] text-muted-foreground">
              Alerts use generic lock-screen copy. Tendnote will ask your browser only after you
              choose Enable.
            </p>
          </div>
          {message ? (
            <p className="text-[length:var(--text-small)] text-muted-foreground">{message}</p>
          ) : null}
          <ReminderCapabilityGuidance capability={capability} />
          <ReminderInvitationActions
            capability={capability}
            onEnable={enable}
            onPostpone={postpone}
            outcome={outcome}
            pendingAction={pendingAction}
          />
        </div>
      </div>
    </aside>
  );
}
