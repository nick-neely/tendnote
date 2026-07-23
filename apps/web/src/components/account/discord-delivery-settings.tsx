"use client";

import { useState, useTransition } from "react";
import {
  configureDiscordTargetAction,
  setDiscordDeliveryEnabledAction,
} from "@/app/actions/integrations";
import {
  CheckIcon,
  CircleSlashIcon,
  MessageCircleIcon,
  PlugIcon,
  TriangleAlertIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isDiscordChannelId } from "@/lib/integrations/discord-install";

/** Lean, serializable view of one install the settings list renders. */
export type DiscordInstallView = {
  guildId: string;
  targetChannelId: string | null;
  enabled: boolean;
};

/**
 * Owner-scoped Discord delivery settings (issue #173). Mirrors the account
 * Integrations vocabulary: each server the owner added the bot to is a calm row
 * with a status badge, a channel to post proactive nudges to, and a pause/resume
 * control. Delivery only ever lands in the channel the owner picks, and nothing is
 * sent without approval — so a fresh install with no channel simply reads as
 * "Needs a channel" rather than nagging.
 */
export function DiscordDeliverySettings({ installs }: { installs: DiscordInstallView[] }) {
  if (installs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-surface px-3.5 py-3">
        <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-muted-foreground">
          You haven&rsquo;t added Tendnote to a Discord server yet.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y rounded-lg border bg-surface">
      {installs.map((install) => (
        <DiscordInstallRow install={install} key={install.guildId} />
      ))}
    </ul>
  );
}

function DiscordInstallRow({ install }: { install: DiscordInstallView }) {
  // A single shared alert surfaces the most recent save/toggle failure; each
  // control clears it before starting so only the live failure is ever shown.
  const [error, setError] = useState<string | null>(null);
  const status = deliveryStatus(install);
  const StatusIcon = status.Icon;

  return (
    <li className="flex flex-col gap-3 px-3.5 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <MessageCircleIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <span className="text-[length:var(--text-body)] leading-[var(--text-body-line)]">
              Discord server
            </span>
            <span className="truncate font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              Guild {install.guildId}
            </span>
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2.5">
          <Badge variant={status.variant}>
            {StatusIcon ? <StatusIcon aria-hidden data-icon="inline-start" /> : null}
            {status.label}
          </Badge>
          <PauseResumeControl install={install} onError={setError} />
        </span>
      </div>

      <ChannelIdForm install={install} onError={setError} />

      {error ? (
        <p
          className="flex items-start gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-accent"
          role="alert"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Pause/resume toggle for one install; reports failures up to the shared row alert. */
function PauseResumeControl({
  install,
  onError,
}: {
  install: DiscordInstallView;
  onError: (message: string | null) => void;
}) {
  const [togglePending, startToggle] = useTransition();

  function toggleEnabled() {
    onError(null);
    startToggle(async () => {
      try {
        await setDiscordDeliveryEnabledAction({
          guildId: install.guildId,
          enabled: !install.enabled,
        });
      } catch {
        // No optimistic flip: the badge reflects real state, and the failure is
        // surfaced rather than swallowed.
        onError(`Couldn't ${install.enabled ? "pause" : "resume"} delivery just now. Try again.`);
      }
    });
  }

  return (
    <Button
      aria-label={`${install.enabled ? "Pause" : "Resume"} delivery for this server`}
      aria-live="polite"
      disabled={togglePending}
      onClick={toggleEnabled}
      size="sm"
      variant="outline"
    >
      {togglePending
        ? install.enabled
          ? "Pausing…"
          : "Resuming…"
        : install.enabled
          ? "Pause"
          : "Resume"}
    </Button>
  );
}

/** Delivery-channel ID field + save control for one install, with its inline format hint. */
function ChannelIdForm({
  install,
  onError,
}: {
  install: DiscordInstallView;
  onError: (message: string | null) => void;
}) {
  const [channelId, setChannelId] = useState(install.targetChannelId ?? "");
  const [savePending, startSave] = useTransition();

  const trimmed = channelId.trim();
  const dirty = trimmed !== (install.targetChannelId ?? "");
  // Non-blocking client hint: skip the round-trip on an obviously malformed id.
  // The server re-validates the snowflake shape regardless (never trusting this).
  const formatInvalid = trimmed.length > 0 && !isDiscordChannelId(trimmed);
  // A save is worth attempting only for a changed id whose shape is plausibly valid;
  // `isDiscordChannelId` already rejects the empty/whitespace case.
  const canSave = dirty && isDiscordChannelId(trimmed);
  const channelInputId = `discord-channel-${install.guildId}`;
  const helpId = `discord-channel-help-${install.guildId}`;
  const hintId = `discord-channel-hint-${install.guildId}`;

  function saveChannel() {
    if (!canSave) {
      return;
    }
    onError(null);
    startSave(async () => {
      try {
        await configureDiscordTargetAction({ guildId: install.guildId, targetChannelId: trimmed });
      } catch {
        // Surface the failure instead of letting a failed save look like a slow
        // success; the input keeps the owner's value so they can retry.
        onError("Couldn't save that channel just now. Check the ID and try again.");
      }
    });
  }

  return (
    <>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          saveChannel();
        }}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <label
            className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground"
            htmlFor={channelInputId}
          >
            Delivery channel ID
          </label>
          <Input
            aria-describedby={formatInvalid ? `${hintId} ${helpId}` : helpId}
            aria-invalid={formatInvalid || undefined}
            autoComplete="off"
            id={channelInputId}
            inputMode="numeric"
            onChange={(event) => setChannelId(event.target.value)}
            placeholder="e.g. 123456789012345678"
            value={channelId}
          />
        </span>
        <Button disabled={!canSave || savePending} size="sm" type="submit">
          {savePending ? "Saving…" : "Save"}
        </Button>
      </form>

      <ChannelFormatHint hintId={hintId} show={formatInvalid} />

      <p
        className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground"
        id={helpId}
      >
        Nudges only go to the channel you set here. To find a channel ID in Discord, enable
        Developer Mode (Settings &rarr; Advanced), then right-click the channel and choose{" "}
        <span className="whitespace-nowrap">Copy Channel ID</span>.
      </p>
    </>
  );
}

/** Inline "17–20 digits" hint, shown only while the typed id is malformed. */
function ChannelFormatHint({ hintId, show }: { hintId: string; show: boolean }) {
  if (!show) {
    return null;
  }
  return (
    <p
      className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground"
      id={hintId}
    >
      A channel ID is 17&ndash;20 digits.
    </p>
  );
}

type StatusMeta = {
  label: string;
  variant: "default" | "outline";
  Icon?: typeof CheckIcon;
};

/** Calm delivery state, mirroring the account Integrations status vocabulary. */
function deliveryStatus(install: DiscordInstallView): StatusMeta {
  if (!install.enabled) {
    return { label: "Paused", variant: "outline", Icon: CircleSlashIcon };
  }
  if (!install.targetChannelId) {
    return { label: "Needs a channel", variant: "outline", Icon: PlugIcon };
  }
  return { label: "Delivery on", variant: "default", Icon: CheckIcon };
}
