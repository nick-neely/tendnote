import { getEveApprovalMode } from "@tendnote/db/queries/access-profiles";
import { getLatestOwnerDataExportJob } from "@tendnote/db/queries/owner-data-export";
import { listReminderInstallations } from "@tendnote/db/queries/reminders";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AssistantApprovalSettings } from "@/components/account/assistant-approval-settings";
import { CalendarPreviewSection } from "@/components/account/calendar-preview-section";
import { OwnerDataExportSection } from "@/components/account/owner-data-export-section";
import { ProviderConnectionsSection } from "@/components/account/provider-connections-section";
import { ReminderSettings } from "@/components/account/reminder-settings";
import { AdmittedRoute } from "@/components/admitted-route";
import { type AppDestinationId, appDestination } from "@/components/app-destinations";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ChevronRightIcon } from "@/components/icons";
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
    <AdmittedRoute destination="account">
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

  // Google Calendar (Phase 2C, ADR-0071) and Gmail (Phase 2D, ADR-0090) can each be
  // connected only when the server has Google credentials configured; otherwise the
  // affordances stay inert. Both read the same gate — the capabilities differ by the
  // narrow scope each requests, not by separate credentials.
  const googleConfigured = isGoogleConfigured(googleEnvFromProcess());
  // Discord (identity linking) is connectable only when Discord credentials are
  // configured server-side; otherwise the affordance stays inert.
  const discordConfigured = isDiscordConfigured(discordEnvFromProcess());
  const initial = view.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
          {appDestination("account").label}
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
              {view.name}
            </span>
            <Badge variant="secondary" title={`Private beta access active: ${view.sourceLabel}`}>
              Private beta
            </Badge>
          </div>
          {view.name !== view.email ? (
            <span className="truncate text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              {view.email}
            </span>
          ) : null}
        </div>
      </section>

      {/* Account's durable sub-destinations. Household lives here because Account
          owns its entry and return point; there is no top-level Household. */}
      <nav aria-label="Account areas" className="flex flex-col gap-2">
        <AccountEntryLink
          description="Keep a few private facts that help Eve understand you."
          destination="account-about-you"
          headingId="about-you-entry-heading"
          label="About you"
        />
        <AccountEntryLink
          description="A small shared layer for the people you live with."
          destination="account-household"
          headingId="household-entry-heading"
          label="Household"
        />
      </nav>

      {/* Integrations — real Provider Connection rows. Calendar (Phase 2C, ADR-0071)
            and Gmail (Phase 2D, ADR-0090) are each connectable when Google credentials
            are configured, behind their own narrow scope. */}
      <Suspense fallback={<AccountRegionReserve label="Provider connections" />}>
        <ProviderConnectionsStream
          calendarConnectable={googleConfigured}
          contactsConnectable={googleConfigured}
          discordConnectable={discordConfigured}
          ensureLocalDemoAuthSession={usingLocalFallback}
          gmailConnectable={googleConfigured}
        />
      </Suspense>

      {/* Read-only Google Calendar preview — provider-derived context, not memory
            or follow-ups; renders only when Calendar is connected (#110). */}
      <Suspense fallback={<AccountRegionReserve label="Calendar preview" />}>
        <CalendarPreviewStream target={calendarTarget} />
      </Suspense>

      {/* How much the assistant does on its own (#549). It sits beside Reminders
            because both are standing answers to "when may this reach me without
            being asked", and neither is a connection or a record. */}
      <Suspense fallback={<AccountRegionReserve label="Assistant approvals" />}>
        <AssistantApprovalSettingsStream ownerUserId={ownerUserId} />
      </Suspense>

      <Suspense fallback={<AccountRegionReserve label="Reminder settings" />}>
        <ReminderSettingsStream ownerUserId={ownerUserId} />
      </Suspense>

      <Suspense fallback={<AccountRegionReserve label="Data export" />}>
        <OwnerDataExportStream ownerUserId={ownerUserId} />
      </Suspense>

      {/* Sign out */}
      <section className="flex flex-col gap-3 border-t pt-6">
        <SignOutButton className="w-full sm:w-auto sm:self-start" />
      </section>
    </div>
  );
}

async function OwnerDataExportStream({ ownerUserId }: { ownerUserId: string }) {
  try {
    const job = await getLatestOwnerDataExportJob(ownerUserId);
    return <OwnerDataExportSection initialJob={job} />;
  } catch {
    return <AccountRegionUnavailable label="Data export" />;
  }
}

/** One row shape for Account's durable sub-destinations, so they stay identical. */
function AccountEntryLink({
  description,
  destination,
  headingId,
  label,
}: {
  description: string;
  destination: AppDestinationId;
  headingId: string;
  label: string;
}) {
  return (
    <Link
      className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-lg border bg-surface px-3.5 py-3 text-left outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
      href={appDestination(destination).route}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className="text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium"
          id={headingId}
        >
          {label}
        </span>
        <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
    </Link>
  );
}

function AccountRegionReserve({ label }: { label: string }) {
  return (
    <section
      aria-busy="true"
      aria-label={label}
      className="h-24 animate-pulse rounded-lg border bg-muted/40"
    />
  );
}

function AccountRegionUnavailable({ label }: { label: string }) {
  return (
    <section
      aria-label={label}
      className="rounded-lg border border-dashed px-3.5 py-3 text-sm text-muted-foreground"
    >
      {label} are unavailable right now. Try again shortly.
    </section>
  );
}

export async function ProviderConnectionsStream({
  calendarConnectable,
  contactsConnectable,
  discordConnectable,
  ensureLocalDemoAuthSession,
  gmailConnectable,
}: {
  calendarConnectable: boolean;
  contactsConnectable: boolean;
  discordConnectable: boolean;
  ensureLocalDemoAuthSession: boolean;
  gmailConnectable: boolean;
}) {
  try {
    const connections = buildProviderConnectionView(await getOwnerProviderConnections());
    return (
      <ProviderConnectionsSection
        calendarConnectable={calendarConnectable}
        contactsConnectable={contactsConnectable}
        connections={connections}
        discordConnectable={discordConnectable}
        ensureLocalDemoAuthSession={ensureLocalDemoAuthSession}
        gmailConnectable={gmailConnectable}
      />
    );
  } catch (error) {
    unstable_rethrow(error);
    return <AccountRegionUnavailable label="Provider connections" />;
  }
}

export async function CalendarPreviewStream({
  target,
}: {
  target: ReturnType<typeof parseCalendarPreviewTarget>;
}) {
  try {
    return <CalendarPreviewSection view={await getOwnerCalendarPreview(target)} />;
  } catch (error) {
    unstable_rethrow(error);
    return <AccountRegionUnavailable label="Calendar preview" />;
  }
}

/**
 * The owner's Approval Mode, read where the admitted owner is already resolved.
 *
 * A failed read is the unavailable region rather than a control defaulted to a
 * mode: the query's own answer for a missing profile is `ask`, and rendering that
 * for a read that never landed would show `Ask every time` selected to someone
 * who chose `Trusted` - a setting reporting the opposite of what the policy will
 * do.
 */
async function AssistantApprovalSettingsStream({ ownerUserId }: { ownerUserId: string }) {
  try {
    return <AssistantApprovalSettings mode={await getEveApprovalMode({ userId: ownerUserId })} />;
  } catch {
    return <AccountRegionUnavailable label="Assistant approvals" />;
  }
}

async function ReminderSettingsStream({ ownerUserId }: { ownerUserId: string }) {
  try {
    return <ReminderSettings installations={await listReminderInstallations({ ownerUserId })} />;
  } catch {
    return <AccountRegionUnavailable label="Reminder settings" />;
  }
}
