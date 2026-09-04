import { Suspense } from "react";
import { AccessCheckFallback } from "@/components/access-check-fallback";
import { AppShellEffects } from "@/components/app-shell-effects";
import { ReminderInstallationProvider } from "@/components/reminder-installation-context";
import { hasAdmittedShellAccess } from "@/lib/access/current-access";

/**
 * The admission gate every signed-in route renders inside.
 *
 * It prerenders an owner-neutral application frame for partial prefetching while
 * keeping it invisible and inert until fresh request-bound admission resolves.
 * Destination content retains its own exact-return admission gate.
 *
 * The shared `(member)` layout owns this boundary. Its ledger and canvas child
 * layouts choose their navigation chrome without re-running admission merely
 * because the owner moved between Today and Assistant. Every destination still
 * checks its exact-return admission and ownership at the data boundary.
 */
export function AdmittedFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="admitted-layout relative min-h-dvh">
      <ReminderInstallationProvider>
        <Suspense fallback={<AdmissionFallback />}>
          <AdmissionMarker />
        </Suspense>
        <div className="admitted-layout-content">{children}</div>
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
