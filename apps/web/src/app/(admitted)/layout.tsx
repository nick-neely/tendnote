import { Suspense } from "react";
import { AccessCheckFallback } from "@/components/access-check-fallback";
import { AppShell } from "@/components/app-shell";
import { AppShellEffects } from "@/components/app-shell-effects";
import { ReminderInstallationProvider } from "@/components/reminder-installation-context";
import { hasAdmittedShellAccess } from "@/lib/access/current-access";
import { readViewerHouseholdAccess } from "@/lib/household/viewer-household-access";

/**
 * Prerenders an owner-neutral application frame for partial prefetching while
 * keeping it invisible and inert until fresh request-bound admission resolves.
 * Destination content retains its own exact-return admission gate.
 */
export default function AdmittedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admitted-layout relative min-h-dvh">
      <ReminderInstallationProvider>
        <Suspense fallback={<AdmissionFallback />}>
          <AdmissionMarker />
        </Suspense>
        <div className="admitted-layout-content">
          {/* Started here and handed down unawaited, so the shell and the
              destination render at once and only the two navigation surfaces
              that can show a Household link wait for the membership read. */}
          <AppShell viewerStandings={readViewerHouseholdAccess()}>{children}</AppShell>
        </div>
      </ReminderInstallationProvider>
    </div>
  );
}

async function AdmissionMarker() {
  if (!(await hasAdmittedShellAccess())) return <AdmissionFallback />;
  return (
    <>
      <span data-admitted hidden />
      <AppShellEffects />
    </>
  );
}

function AdmissionFallback() {
  return (
    <div className="absolute inset-0 z-50 bg-background">
      <AccessCheckFallback />
    </div>
  );
}
