import { CheckIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { ProviderConnectionsSection } from "@/components/account/provider-connections-section";
import { AppShell } from "@/components/app-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { localFallbackOwnerUserId } from "@/lib/access/access-state";
import { resolveAccountView } from "@/lib/access/account-summary";
import { getCurrentAccess } from "@/lib/access/current-access";
import { googleEnvFromProcess, isGoogleConfigured } from "@/lib/auth/social";
import { buildProviderConnectionView } from "@/lib/integrations/provider-connection-view";
import { getOwnerProviderConnections } from "@/lib/integrations/provider-connections";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const access = await getCurrentAccess();
  const view = resolveAccountView(
    access,
    localFallbackOwnerUserId({
      nodeEnv: process.env.NODE_ENV,
      devOwnerUserId: process.env.TENDNOTE_DEV_OWNER_USER_ID,
    }),
  );

  if (view.type === "redirect") {
    redirect(view.to);
  }

  // Admitted-only: getOwnerProviderConnections resolves the admitted owner before
  // reading, so pending/unauthenticated users never reach connection state.
  const connections = buildProviderConnectionView(await getOwnerProviderConnections());
  // Google Calendar can be connected only when the server has Google credentials
  // configured (Phase 2C, ADR-0071); otherwise the affordance stays inert.
  const calendarConnectable = isGoogleConfigured(googleEnvFromProcess());

  const initial = view.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
            Account
          </h1>
          <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            Your identity and access. Tendnote keeps this deliberately small.
          </p>
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

        {/* Integrations — real Provider Connection rows; Calendar is connectable in
            Phase 2C when Google credentials are configured (ADR-0071). */}
        <ProviderConnectionsSection
          calendarConnectable={calendarConnectable}
          connections={connections}
        />

        {/* Sign out */}
        <section className="flex flex-col gap-3 border-t pt-6">
          <SignOutButton className="w-full sm:w-auto sm:self-start" />
        </section>
      </div>
    </AppShell>
  );
}
