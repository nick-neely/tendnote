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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProviderConnectionView } from "@/lib/integrations/provider-connection-view";
import { CalendarConnectButton } from "./calendar-connect-button";

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

/**
 * Account integration settings: real Provider Connection status rows (#101,
 * ADR-0069). In Phase 2C (ADR-0071) Google Calendar can be connected when Google
 * credentials are configured — its row starts the real Better Auth linkSocial flow
 * — while Gmail and Contacts stay inert until their later phases. Built as a
 * standalone section so a future settings/integrations route can reuse it.
 */
export function ProviderConnectionsSection({
  connections,
  calendarConnectable = false,
}: {
  connections: ProviderConnectionView[];
  /** True only when Google credentials are configured server-side (Phase 2C). */
  calendarConnectable?: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground">
        Integrations
      </h2>

      <ul className="flex flex-col divide-y rounded-lg border bg-surface">
        {connections.map((connection) => (
          <ProviderConnectionRow
            connectable={
              calendarConnectable &&
              connection.providerKey === "google" &&
              connection.capabilityKey === "calendar"
            }
            connection={connection}
            key={`${connection.providerKey}:${connection.capabilityKey}`}
          />
        ))}
      </ul>

      <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
        {calendarConnectable ? (
          <>
            Connect Google Calendar to let Tendnote read upcoming and recent events — read-only,
            behind your explicit Google consent. Gmail and Contacts stay disconnected and arrive in
            later phases. Tendnote isn&rsquo;t reading any other Google data.
          </>
        ) : (
          <>
            These aren&rsquo;t connected yet. Calendar, Gmail, and Contacts will connect later, each
            behind its own narrow permission and your explicit approval — Tendnote isn&rsquo;t
            reading any Google data.
          </>
        )}
      </p>
    </section>
  );
}

function ProviderConnectionRow({
  connection,
  connectable,
}: {
  connection: ProviderConnectionView;
  connectable: boolean;
}) {
  const status = STATUS_META[connection.status];
  const StatusIcon = status.Icon;
  const CapabilityIcon = CAPABILITY_ICONS[connection.capabilityKey] ?? PlugIcon;

  const isConnected = connection.status === "connected";
  const isUnavailable = connection.status === "unavailable";
  const actionLabel = isConnected ? "Disconnect" : "Connect";
  // A connectable, not-yet-connected Calendar row gets the live connect flow;
  // every other affordance stays inert until its phase wires it.
  const showConnect = connectable && !isConnected && !isUnavailable;

  return (
    <li className="flex items-center justify-between gap-3 px-3.5 py-3">
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
        {isUnavailable ? null : showConnect ? (
          <CalendarConnectButton label={connection.label} />
        ) : (
          // Inert: no OAuth scopes, no token handling. Disabled (not just styled)
          // so it is unfocusable and cannot be triggered. Disconnect for a live
          // Calendar connection is wired in a later slice (#109).
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
    </li>
  );
}
