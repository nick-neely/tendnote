import type { ProviderConnectionStatus } from "@tendnote/domain";
import {
  CalendarIcon,
  CheckIcon,
  CircleSlashIcon,
  ClockIcon,
  type LucideIcon,
  MailIcon,
  MessageCircleIcon,
  PlugIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { capabilityDisconnectKind } from "@/lib/integrations/capability-lifecycle";
import type { ProviderConnectionView } from "@/lib/integrations/provider-connection-view";
import { CalendarConnectButton } from "./calendar-connect-button";
import { CalendarDisconnectButton } from "./calendar-disconnect-button";
import { ContactsConnectButton } from "./contacts-connect-button";
import { ContactsDisconnectButton } from "./contacts-disconnect-button";
import { DiscordConnectButton } from "./discord-connect-button";
import { DiscordDisconnectButton } from "./discord-disconnect-button";
import { GmailConnectButton } from "./gmail-connect-button";

/** Revocation reason set when disconnect could not revoke the Google-side grant. */
const PROVIDER_GRANT_NOT_REVOKED_REASON = "user_disconnect_provider_grant_not_revoked";

type BadgeVariant = "default" | "outline";

const STATUS_META: Record<
  ProviderConnectionStatus,
  { label: string; variant: BadgeVariant; Icon?: LucideIcon; className?: string }
> = {
  ready: { label: "Not connected", variant: "outline" },
  pending: { label: "Pending", variant: "outline", Icon: ClockIcon },
  connected: { label: "Connected", variant: "default", Icon: CheckIcon },
  revoked: { label: "Disconnected", variant: "outline", Icon: CircleSlashIcon },
  // Clay accent is the system's "needs review/attention" weight (DESIGN §3) — not
  // destructive red. Tinted via transparency so it holds in both themes.
  error: {
    label: "Needs attention",
    variant: "outline",
    Icon: TriangleAlertIcon,
    className: "border-accent/30 bg-accent/10 text-accent",
  },
  unavailable: { label: "Unavailable", variant: "outline" },
};

const CAPABILITY_ICONS: Record<string, LucideIcon> = {
  calendar: CalendarIcon,
  gmail: MailIcon,
  contacts: UsersRoundIcon,
  channel: MessageCircleIcon,
};

type ConnectableConfig = {
  calendarConnectable: boolean;
  contactsConnectable: boolean;
  gmailConnectable: boolean;
  discordConnectable: boolean;
};

type CapabilityAction = {
  configuredBy: keyof ConnectableConfig;
  ConnectButton: ComponentType<{ ensureLocalDemoAuthSession?: boolean; label: string }>;
  DisconnectButton?: ComponentType<{ label: string }>;
};

const GOOGLE_CAPABILITY_ACTIONS: Record<string, CapabilityAction> = {
  calendar: {
    configuredBy: "calendarConnectable",
    ConnectButton: CalendarConnectButton,
    DisconnectButton: CalendarDisconnectButton,
  },
  contacts: {
    configuredBy: "contactsConnectable",
    ConnectButton: ContactsConnectButton,
    DisconnectButton: ContactsDisconnectButton,
  },
  gmail: {
    configuredBy: "gmailConnectable",
    ConnectButton: GmailConnectButton,
  },
};

const DISCORD_CAPABILITY_ACTIONS: Record<string, CapabilityAction> = {
  channel: {
    configuredBy: "discordConnectable",
    ConnectButton: DiscordConnectButton,
    DisconnectButton: DiscordDisconnectButton,
  },
};

/** Live connect/disconnect wiring for a capability, keyed by its provider. */
const CAPABILITY_ACTIONS: Record<string, Record<string, CapabilityAction>> = {
  google: GOOGLE_CAPABILITY_ACTIONS,
  discord: DISCORD_CAPABILITY_ACTIONS,
};

function capabilityAction(ref: {
  providerKey: string;
  capabilityKey: string;
}): CapabilityAction | undefined {
  return CAPABILITY_ACTIONS[ref.providerKey]?.[ref.capabilityKey];
}

/**
 * Whether this row wires a live disconnect control. Exported so a test can cross-check
 * it against the catalog's declared disconnect kind (`capabilityDisconnectKind`): the
 * UI must offer a disconnect affordance for exactly the capabilities the catalog marks
 * disconnectable, so the two sources of disconnect truth cannot drift.
 */
export function capabilityHasDisconnectAffordance(ref: {
  providerKey: string;
  capabilityKey: string;
}): boolean {
  return Boolean(capabilityAction(ref)?.DisconnectButton);
}

/**
 * Account integration settings: real Provider Connection status rows (#101,
 * ADR-0069). Google Calendar and Gmail can be connected when Google credentials
 * are configured; each row starts a narrow Better Auth linkSocial flow for its
 * capability. Contacts also exposes the first import-preview entry point. Built as a standalone
 * section so a future settings/integrations route can reuse it.
 */
export function ProviderConnectionsSection({
  connections,
  calendarConnectable = false,
  contactsConnectable = false,
  gmailConnectable = false,
  discordConnectable = false,
  ensureLocalDemoAuthSession = false,
}: {
  connections: ProviderConnectionView[];
  /** True only when Google credentials are configured server-side (Phase 2C). */
  calendarConnectable?: boolean;
  /** True only when Google credentials are configured server-side (Phase 2E). */
  contactsConnectable?: boolean;
  /** True only when Google credentials are configured server-side (Phase 2D). */
  gmailConnectable?: boolean;
  /** True only when Discord credentials are configured server-side. */
  discordConnectable?: boolean;
  /** True when local fallback access needs a real Better Auth session before OAuth linking. */
  ensureLocalDemoAuthSession?: boolean;
}) {
  const anyConnectable =
    calendarConnectable || gmailConnectable || contactsConnectable || discordConnectable;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground">
        Integrations
      </h2>

      <ul className="flex flex-col divide-y rounded-lg border bg-surface">
        {connections.map((connection) => (
          <ProviderConnectionRow
            connectable={isCapabilityConnectable(connection, {
              calendarConnectable,
              contactsConnectable,
              gmailConnectable,
              discordConnectable,
            })}
            connection={connection}
            ensureLocalDemoAuthSession={ensureLocalDemoAuthSession}
            key={`${connection.providerKey}:${connection.capabilityKey}`}
          />
        ))}
      </ul>

      <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
        {anyConnectable ? (
          <>
            Each connects behind its own narrow consent — none implies another. Calendar reads
            upcoming and recent events (read-only). Gmail saves drafts you approve (never sending).
            Contacts previews personal contacts before anything&rsquo;s saved. Discord links your
            identity so captures reach Tendnote (no messages read).
          </>
        ) : (
          <>
            These aren&rsquo;t connected yet. Add the matching provider credentials to connect
            Calendar, Gmail, Contacts, and Discord, each behind its own narrow permission and your
            explicit approval. Tendnote isn&rsquo;t reading any of this data.
          </>
        )}
      </p>
    </section>
  );
}

/** Which capabilities the account row can start a live connect flow for. */
function isCapabilityConnectable(
  connection: ProviderConnectionView,
  configured: ConnectableConfig,
): boolean {
  const action = capabilityAction(connection);
  return action ? configured[action.configuredBy] : false;
}

function ProviderConnectionRow({
  connection,
  connectable,
  ensureLocalDemoAuthSession,
}: {
  connection: ProviderConnectionView;
  /** True for a Google capability whose live connect flow is wired and configured. */
  connectable: boolean;
  ensureLocalDemoAuthSession: boolean;
}) {
  const CapabilityIcon = CAPABILITY_ICONS[connection.capabilityKey] ?? PlugIcon;

  return (
    <li className="flex flex-col gap-2 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <CapabilityIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[length:var(--text-body)] leading-[var(--text-body-line)]">
              {connection.label}
            </span>
            {connection.displayIdentity ? (
              <span className="truncate font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
                {connection.displayIdentity}
              </span>
            ) : null}
          </span>
        </span>

        <ProviderRowControl
          connectable={connectable}
          connection={connection}
          ensureLocalDemoAuthSession={ensureLocalDemoAuthSession}
        />
      </div>

      <ProviderRowNotes connectable={connectable} connection={connection} />
    </li>
  );
}

/** Status badge + the row's single connect/disconnect (or inert) affordance. */
function ProviderRowControl({
  connection,
  connectable,
  ensureLocalDemoAuthSession,
}: {
  connection: ProviderConnectionView;
  connectable: boolean;
  ensureLocalDemoAuthSession: boolean;
}) {
  const status = STATUS_META[connection.status];
  const StatusIcon = status.Icon;

  return (
    <span className="flex shrink-0 items-center gap-2.5">
      <Badge className={status.className} variant={status.variant}>
        {StatusIcon ? <StatusIcon aria-hidden data-icon="inline-start" /> : null}
        {status.label}
      </Badge>
      <ProviderConnectAffordance
        connectable={connectable}
        connection={connection}
        ensureLocalDemoAuthSession={ensureLocalDemoAuthSession}
      />
    </span>
  );
}

/**
 * The single affordance for a row: a live connect or disconnect control when the
 * capability is wired and configured, nothing for an unavailable capability, and
 * otherwise an inert disabled button (no OAuth scopes, no token handling — disabled
 * rather than styled so it is unfocusable and cannot be triggered).
 */
function ProviderConnectAffordance({
  connection,
  connectable,
  ensureLocalDemoAuthSession,
}: {
  connection: ProviderConnectionView;
  connectable: boolean;
  ensureLocalDemoAuthSession: boolean;
}) {
  const { ConnectButton, DisconnectButton } = capabilityAction(connection) ?? {};
  const isConnected = connection.status === "connected";
  const actionLabel = isConnected ? "Disconnect" : "Connect";
  // Inert fallback: no OAuth scopes, no token handling. Disabled (not just styled)
  // so it is unfocusable and cannot be triggered.
  const inertAffordance = (
    <Button
      aria-label={`${actionLabel} ${connection.label} (not available yet)`}
      disabled
      size="sm"
      variant="outline"
    >
      {actionLabel}
    </Button>
  );

  if (connection.status === "unavailable") {
    return null;
  }
  if (!connectable) {
    return inertAffordance;
  }
  if (ConnectButton && !isConnected) {
    return (
      <ConnectButton
        ensureLocalDemoAuthSession={ensureLocalDemoAuthSession}
        label={connection.label}
      />
    );
  }
  if (DisconnectButton && isConnected) {
    return <DisconnectButton label={connection.label} />;
  }
  return inertAffordance;
}

/** Capability-specific footnotes: cleanup/error status notes and live entry points. */
function ProviderRowNotes({
  connection,
  connectable,
}: {
  connection: ProviderConnectionView;
  connectable: boolean;
}) {
  return (
    <>
      <ProviderRowStatusNotes connectable={connectable} connection={connection} />
      <ProviderRowEntryPoints connectable={connectable} connection={connection} />
    </>
  );
}

/** Cleanup guidance after a partial disconnect, and any surfaced error detail. */
function ProviderRowStatusNotes({
  connection,
  connectable,
}: {
  connection: ProviderConnectionView;
  connectable: boolean;
}) {
  // The "finish revocation at the provider" note belongs to the `provider_grant`
  // disconnect semantics (revoke-the-grant-then-unlink), which the catalog declares —
  // not to a `capabilityKey === "calendar"` literal. Keyed off the descriptor so it
  // stays correct if another capability ever adopts that disconnect kind (ADR-0080).
  const isProviderGrantDisconnect =
    capabilityDisconnectKind({
      providerKey: connection.providerKey,
      capabilityKey: connection.capabilityKey,
    }) === "provider_grant";
  // After a disconnect that could not revoke the Google-side grant, the user still
  // has cleanup to finish in their Google Account (ADR-0080).
  const showCleanupNote =
    connectable &&
    isProviderGrantDisconnect &&
    connection.status === "revoked" &&
    connection.revocationReason === PROVIDER_GRANT_NOT_REVOKED_REASON;

  return (
    <>
      {showCleanupNote ? (
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground">
          Tendnote has stopped reading your calendar and cleared its cached events. To fully revoke
          access, remove Tendnote from your{" "}
          <a
            className="underline underline-offset-2"
            href="https://myaccount.google.com/permissions"
            rel="noreferrer"
            target="_blank"
          >
            Google Account permissions
          </a>
          .
        </p>
      ) : null}
      {connection.status === "error" && connection.lastErrorMessage ? (
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground">
          {connection.lastErrorMessage}
        </p>
      ) : null}
    </>
  );
}

/** Live preview/delivery entry points, only ever shown for a configured capability. */
function ProviderRowEntryPoints({
  connection,
  connectable,
}: {
  connection: ProviderConnectionView;
  connectable: boolean;
}) {
  if (!connectable) {
    return null;
  }

  const isContacts = connection.capabilityKey === "contacts";
  const isDiscordChannel =
    connection.providerKey === "discord" && connection.capabilityKey === "channel";

  return (
    <>
      {isContacts && connection.status === "ready" ? (
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground">
          Preview latest contacts before saving anything to Tendnote.
        </p>
      ) : null}
      {isContacts && connection.status === "connected" ? (
        <a
          className="self-start text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-primary underline underline-offset-2"
          href="/account/contacts/import"
        >
          Preview latest contacts
        </a>
      ) : null}
      {isDiscordChannel && connection.status === "connected" ? (
        <a
          className="self-start text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-primary underline underline-offset-2"
          href="/account/discord"
        >
          Set up delivery
        </a>
      ) : null}
    </>
  );
}
