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
 * It is a component rather than the body of one layout because two layouts need
 * it: the rail shell in `(admitted)`, and the canvas shell in `(canvas)` for the
 * one route that brings its own rail (ADR 0239). Which shell a route gets is
 * therefore a fact about where the route file lives, decided at build time —
 * not a pathname a client component reads, which would make this frame dynamic
 * under `cacheComponents` and cost every route its static shell.
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
