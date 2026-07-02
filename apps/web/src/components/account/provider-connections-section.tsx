import type { ProviderConnectionStatus } from "@tendnote/domain";
import {
  CalendarIcon,
  CheckIcon,
  CircleSlashIcon,
  ClockIcon,
  type LucideIcon,
  MailIcon,
  PlugIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProviderConnectionView } from "@/lib/integrations/provider-connection-view";
import { CalendarConnectButton } from "./calendar-connect-button";
import { CalendarDisconnectButton } from "./calendar-disconnect-button";
import { ContactsConnectButton } from "./contacts-connect-button";
import { ContactsDisconnectButton } from "./contacts-disconnect-button";
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
};

type ConnectableConfig = {
  calendarConnectable: boolean;
  contactsConnectable: boolean;
  gmailConnectable: boolean;
};

type CapabilityAction = {
  configuredBy: keyof ConnectableConfig;
  ConnectButton: ComponentType<{ label: string }>;
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
}: {
  connections: ProviderConnectionView[];
  /** True only when Google credentials are configured server-side (Phase 2C). */
  calendarConnectable?: boolean;
  /** True only when Google credentials are configured server-side (Phase 2E). */
  contactsConnectable?: boolean;
  /** True only when Google credentials are configured server-side (Phase 2D). */
  gmailConnectable?: boolean;
}) {
  const anyConnectable = calendarConnectable || gmailConnectable || contactsConnectable;
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
            })}
            connection={connection}
            key={`${connection.providerKey}:${connection.capabilityKey}`}
          />
        ))}
      </ul>

      <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
        {anyConnectable ? (
          <>
            Connect Google Calendar to let Tendnote read upcoming and recent events — read-only.
            Connect Gmail to let Tendnote save email drafts you approve — draft-only, never sending.
            Connect Google Contacts to preview personal contacts before anything is saved. Each
            connects behind its own narrow Google consent, and none implies the other.
          </>
        ) : (
          <>
            These aren&rsquo;t connected yet. Add Google credentials to connect Calendar, Gmail, and
            Contacts, each behind its own narrow permission and your explicit approval. Tendnote
            isn&rsquo;t reading any Google data.
          </>
        )}
      </p>
    </section>
  );
}

/** Which Google capabilities the account row can start a live connect flow for. */
function isCapabilityConnectable(
  connection: ProviderConnectionView,
  configured: ConnectableConfig,
): boolean {
  if (connection.providerKey !== "google") {
    return false;
  }
  const action = GOOGLE_CAPABILITY_ACTIONS[connection.capabilityKey];
  return action ? configured[action.configuredBy] : false;
}

function ProviderConnectionRow({
  connection,
  connectable,
}: {
  connection: ProviderConnectionView;
  /** True for a Google capability whose live connect flow is wired and configured. */
  connectable: boolean;
}) {
  const status = STATUS_META[connection.status];
  const StatusIcon = status.Icon;
  const CapabilityIcon = CAPABILITY_ICONS[connection.capabilityKey] ?? PlugIcon;
  const action =
    connection.providerKey === "google"
      ? GOOGLE_CAPABILITY_ACTIONS[connection.capabilityKey]
      : undefined;

  const isConnected = connection.status === "connected";
  const isUnavailable = connection.status === "unavailable";
  const actionLabel = isConnected ? "Disconnect" : "Connect";
  const isCalendar = connection.capabilityKey === "calendar";
  const isContacts = connection.capabilityKey === "contacts";
  const ConnectButton = action?.ConnectButton;
  const DisconnectButton = action?.DisconnectButton;
  const showConnect = Boolean(connectable && ConnectButton && !isConnected && !isUnavailable);
  const showDisconnect = Boolean(connectable && DisconnectButton && isConnected);
  // After a disconnect that could not revoke the Google-side grant, the user still
  // has cleanup to finish in their Google Account (ADR-0080).
  const showCleanupNote =
    connectable &&
    isCalendar &&
    connection.status === "revoked" &&
    connection.revocationReason === PROVIDER_GRANT_NOT_REVOKED_REASON;

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

        <span className="flex shrink-0 items-center gap-2.5">
          <Badge className={status.className} variant={status.variant}>
            {StatusIcon ? <StatusIcon aria-hidden data-icon="inline-start" /> : null}
            {status.label}
          </Badge>
          {isUnavailable ? null : showConnect && ConnectButton ? (
            <ConnectButton label={connection.label} />
          ) : showDisconnect && DisconnectButton ? (
            <DisconnectButton label={connection.label} />
          ) : (
            // Inert: no OAuth scopes, no token handling. Disabled (not just styled)
            // so it is unfocusable and cannot be triggered.
            <Button
              aria-label={`${actionLabel} ${connection.label} (not available yet)`}
              disabled
              size="sm"
              variant="outline"
            >
              {actionLabel}
            </Button>
          )}
        </span>
      </div>

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
      {connectable && isContacts && connection.status === "ready" ? (
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground">
          Preview latest contacts before saving anything to Tendnote.
        </p>
      ) : null}
      {connectable && isContacts && connection.status === "connected" ? (
        <a
          className="self-start text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-primary underline underline-offset-2"
          href="/account/contacts/import"
        >
          Preview latest contacts
        </a>
      ) : null}
    </li>
  );
}
