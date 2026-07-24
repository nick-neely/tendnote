import { listReminderInstallations } from "@tendnote/db/queries/reminders";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CalendarPreviewSection } from "@/components/account/calendar-preview-section";
import { ProviderConnectionsSection } from "@/components/account/provider-connections-section";
import { ReminderSettings } from "@/components/account/reminder-settings";
import { AdmittedRoute } from "@/components/admitted-route";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { CheckIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { localFallbackOwnerUserId } from "@/lib/access/access-state";
import { resolveAccountView } from "@/lib/access/account-summary";
import { getCurrentAccess } from "@/lib/access/current-access";
import { signInPathFor } from "@/lib/auth/return-to";
import {
  discordEnvFromProcess,
  googleEnvFromProcess,
  isDiscordConfigured,
  isGoogleConfigured,
} from "@/lib/auth/social";
import { parseCalendarPreviewTarget } from "@/lib/integrations/calendar-preview";
import { getOwnerCalendarPreview } from "@/lib/integrations/calendar-preview-data";
import { buildProviderConnectionView } from "@/lib/integrations/provider-connection-view";
import { getOwnerProviderConnections } from "@/lib/integrations/provider-connections";

type AccountPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default function AccountPage(props: AccountPageProps = {}) {
  return (
    <AdmittedRoute returnTo="/account" title="Account">
      <AccountContent {...props} />
    </AdmittedRoute>
  );
}

export async function AccountContent({ searchParams }: AccountPageProps = {}) {
  if (process.env.NODE_ENV !== "test") await connection();
  const calendarTarget = parseCalendarPreviewTarget((await searchParams) ?? {});
  const access = await getCurrentAccess();
  const fallbackOwnerUserId = localFallbackOwnerUserId({
    nodeEnv: process.env.NODE_ENV,
    devOwnerUserId: process.env.TENDNOTE_DEV_OWNER_USER_ID,
  });
  const view = resolveAccountView(access, fallbackOwnerUserId);

  if (view.type === "redirect") {
    redirect(view.to === "/sign-in" ? signInPathFor("/account") : view.to);
  }
  const ownerUserId = access.state === "admitted" ? access.user.id : fallbackOwnerUserId;
  if (!ownerUserId) redirect(signInPathFor("/account"));
  const usingLocalFallback = access.state === "unauthenticated";

  // Admitted-only: getOwnerProviderConnections resolves the admitted owner before
  // reading, so pending/unauthenticated users never reach connection state.
  const connections = buildProviderConnectionView(await getOwnerProviderConnections());
  // Google Calendar (Phase 2C, ADR-0071) and Gmail (Phase 2D, ADR-0090) can each be
  // connected only when the server has Google credentials configured; otherwise the
  // affordances stay inert. Both read the same gate — the capabilities differ by the
  // narrow scope each requests, not by separate credentials.
  const googleConfigured = isGoogleConfigured(googleEnvFromProcess());
  // Discord (identity linking) is connectable only when Discord credentials are
  // configured server-side; otherwise the affordance stays inert.
  const discordConfigured = isDiscordConfigured(discordEnvFromProcess());
  // Read-only bounded preview of the connected calendar; hidden when not connected.
  const calendarPreview = await getOwnerCalendarPreview(calendarTarget);
  const reminderInstallations = await listReminderInstallations({ ownerUserId });

  const initial = view.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
          Account
        </h1>
      </header>

      {/* Identity */}
      <section className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-[length:var(--text-title)] font-medium text-secondary-foreground"
        >
          {initial}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
            {view.name}
          </span>
          {view.name !== view.email ? (
            <span className="truncate text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              {view.email}
            </span>
          ) : null}
        </div>
      </section>

      {/* Access status */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground">
          Access
        </h2>
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-surface px-3.5 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-[length:var(--text-body)] leading-[var(--text-body-line)]">
              Private Beta Access
            </span>
            <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              {view.sourceLabel}
            </span>
          </div>
          <Badge>
            <CheckIcon aria-hidden data-icon="inline-start" />
            Active
          </Badge>
        </div>
      </section>

      {/* Integrations — real Provider Connection rows. Calendar (Phase 2C, ADR-0071)
            and Gmail (Phase 2D, ADR-0090) are each connectable when Google credentials
            are configured, behind their own narrow scope. */}
      <ProviderConnectionsSection
        calendarConnectable={googleConfigured}
        contactsConnectable={googleConfigured}
        connections={connections}
        discordConnectable={discordConfigured}
        ensureLocalDemoAuthSession={usingLocalFallback}
        gmailConnectable={googleConfigured}
      />

      {/* Read-only Google Calendar preview — provider-derived context, not memory
            or follow-ups; renders only when Calendar is connected (#110). */}
      <CalendarPreviewSection view={calendarPreview} />

      <ReminderSettings installations={reminderInstallations} />

      {/* Sign out */}
      <section className="flex flex-col gap-3 border-t pt-6">
        <SignOutButton className="w-full sm:w-auto sm:self-start" />
      </section>
    </div>
  );
}
