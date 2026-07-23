"use client";

import type { ReminderInstallationSummary } from "@tendnote/domain/reminders";
import { MonitorSmartphoneIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";

function statusLabel(status: ReminderInstallationSummary["status"]) {
  if (status === "enabled") return "On";
  if (status === "disabled") return "Off";
  return "Revoked";
}

export function ReminderInstallationRow({
  currentOptInState,
  installation,
  isCurrent,
  onChangePreview,
  onEnable,
  onRevoke,
  onTurnOff,
  pending,
}: {
  currentOptInState: string | null;
  installation: ReminderInstallationSummary;
  isCurrent: boolean;
  onChangePreview: (installation: ReminderInstallationSummary, detailed: boolean) => void;
  onEnable: () => void;
  onRevoke: (installation: ReminderInstallationSummary) => void;
  onTurnOff: (installation: ReminderInstallationSummary) => void;
  pending: string | null;
}) {
  const isBusy = pending?.endsWith(installation.id) === true;
  return (
    <div className="flex flex-col gap-3 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <MonitorSmartphoneIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[length:var(--text-body)]">{installation.label}</span>
            <span className="text-[length:var(--text-small)] text-muted-foreground">
              {isCurrent ? "This installation" : "Another installation"} ·{" "}
              {statusLabel(installation.status)}
            </span>
          </div>
        </div>
        {isBusy ? <Spinner aria-label="Updating reminder installation" /> : null}
      </div>

      <InstallationControls
        currentOptInState={currentOptInState}
        installation={installation}
        isCurrent={isCurrent}
        onChangePreview={onChangePreview}
        onEnable={onEnable}
        onRevoke={onRevoke}
        onTurnOff={onTurnOff}
        pending={pending}
      />
    </div>
  );
}

function InstallationControls(props: {
  currentOptInState: string | null;
  installation: ReminderInstallationSummary;
  isCurrent: boolean;
  onChangePreview: (installation: ReminderInstallationSummary, detailed: boolean) => void;
  onEnable: () => void;
  onRevoke: (installation: ReminderInstallationSummary) => void;
  onTurnOff: (installation: ReminderInstallationSummary) => void;
  pending: string | null;
}) {
  if (props.isCurrent && props.installation.status === "enabled") {
    return <CurrentInstallationControls {...props} />;
  }
  if (props.isCurrent) {
    const label =
      props.pending === "enable"
        ? "Checking…"
        : props.currentOptInState === "denied"
          ? "Check again"
          : "Enable again";
    return (
      <Button
        className="self-start"
        disabled={props.pending !== null}
        onClick={props.onEnable}
        size="sm"
        type="button"
      >
        {label}
      </Button>
    );
  }
  if (props.installation.status !== "enabled") return null;
  return (
    <Button
      aria-label={`Revoke ${props.installation.label}`}
      className="self-start pl-7"
      disabled={props.pending !== null}
      onClick={() => props.onRevoke(props.installation)}
      size="sm"
      type="button"
      variant="ghost"
    >
      Revoke installation
    </Button>
  );
}

function CurrentInstallationControls(props: {
  installation: ReminderInstallationSummary;
  onChangePreview: (installation: ReminderInstallationSummary, detailed: boolean) => void;
  onTurnOff: (installation: ReminderInstallationSummary) => void;
  pending: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 pl-7">
      <div className="flex items-start gap-2 text-[length:var(--text-small)]">
        <Checkbox
          aria-label="Show reminder details"
          checked={props.installation.previewMode === "detailed"}
          disabled={props.pending !== null}
          onCheckedChange={(checked) => props.onChangePreview(props.installation, checked === true)}
        />
        <span>
          Show reminder details
          <span className="block text-muted-foreground">
            Title and scheduled time only. Sensitive reminders stay generic.
          </span>
        </span>
      </div>
      <Button
        className="self-start"
        disabled={props.pending !== null}
        onClick={() => props.onTurnOff(props.installation)}
        size="sm"
        type="button"
        variant="outline"
      >
        Turn off reminders on this installation
      </Button>
    </div>
  );
}

export function ReminderBlockedInstallation({
  action,
  onEnable,
  pending,
}: {
  action: string;
  onEnable: () => void;
  pending: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 px-3.5 py-3">
      <div className="flex items-start gap-3">
        <MonitorSmartphoneIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="flex flex-col gap-1">
          <span className="text-[length:var(--text-body)]">This installation · Blocked</span>
          <span className="text-[length:var(--text-small)] text-muted-foreground">
            Allow notifications for Tendnote in this browser or your operating-system settings, then
            check permission again.
          </span>
        </div>
      </div>
      <Button
        className="self-start"
        disabled={pending !== null}
        onClick={onEnable}
        size="sm"
        type="button"
      >
        {pending === "enable" ? "Checking…" : action}
      </Button>
    </div>
  );
}
