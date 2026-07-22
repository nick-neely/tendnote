"use client";

import type { ReminderInstallationSummary } from "@tendnote/domain/reminders";
import { BellOffIcon } from "lucide-react";
import {
  ReminderBlockedInstallation,
  ReminderInstallationRow,
} from "@/components/account/reminder-installation-row";
import { useReminderInstallationSettings } from "@/components/account/use-reminder-installation-settings";

type SafeInstallation = ReminderInstallationSummary;

export function ReminderSettings({ installations }: { installations: SafeInstallation[] }) {
  const settings = useReminderInstallationSettings(installations);
  const {
    changePreview,
    current,
    currentClientId,
    currentOptInState,
    enableAgain,
    items,
    message,
    pending,
    recoveryAction,
    registrationOutcome,
    revokeRemote,
    turnOffCurrent,
  } = settings;

  return (
    <section aria-labelledby="reminder-settings-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
          id="reminder-settings-heading"
        >
          Reminders
        </h2>
        <p className="max-w-[65ch] text-[length:var(--text-small)] text-muted-foreground">
          Each browser or installed app opts in separately. Lock-screen alerts stay generic.
        </p>
      </div>

      <div className="divide-y rounded-lg border bg-surface">
        {items.length === 0 && !recoveryAction ? (
          <div className="flex items-start gap-3 px-3.5 py-3">
            <BellOffIcon aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
            <p className="text-[length:var(--text-small)] text-muted-foreground">
              No installation has reminders enabled yet.
            </p>
          </div>
        ) : (
          items.map((installation) => (
            <ReminderInstallationRow
              currentOptInState={currentOptInState}
              installation={installation}
              isCurrent={installation.clientInstallationId === currentClientId}
              key={installation.id}
              onChangePreview={changePreview}
              onEnable={enableAgain}
              onRevoke={revokeRemote}
              onTurnOff={turnOffCurrent}
              pending={pending}
            />
          ))
        )}
        {currentClientId && !current && recoveryAction ? (
          <ReminderBlockedInstallation
            action={recoveryAction}
            onEnable={enableAgain}
            pending={pending}
          />
        ) : null}
      </div>

      {registrationOutcome?.status === "install_required" ? (
        <p className="text-[length:var(--text-small)] text-muted-foreground" role="status">
          In Safari, tap Share, choose Add to Home Screen, then open Tendnote there.
        </p>
      ) : null}
      {registrationOutcome?.status === "unsupported" ? (
        <p className="text-[length:var(--text-small)] text-muted-foreground" role="status">
          Reminders don&rsquo;t work in this browser. Check Today instead.
        </p>
      ) : null}
      {registrationOutcome?.status === "registration_failed" ? (
        <p className="text-[length:var(--text-small)] text-muted-foreground" role="status">
          Permission is allowed, but this installation isn&rsquo;t registered yet.
        </p>
      ) : null}
      {message ? (
        <p className="text-[length:var(--text-small)] text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
