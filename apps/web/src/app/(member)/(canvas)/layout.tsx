import { AppShell } from "@/components/app-shell";
import { BillingNotice } from "@/components/billing/billing-notice";
import { ServiceNotice } from "@/components/service-notice-banner";
import { readViewerHouseholdAccess } from "@/lib/household/viewer-household-access";

/**
 * The shell for a destination that takes the whole window and brings its own
 * rail — today only the Assistant.
 *
 * Same admission gate, same phone shell, and the same destinations in the same
 * order as `(admitted)`; what it drops is the sidebar provider, because exactly
 * one may be mounted at a time (ADR 0239). The rail itself stays, fixed to icon
 * width. Membership still comes down for it and for the phone Menu.
 */
export default function CanvasLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      canvas
      notice={
        <>
          <ServiceNotice />
          <BillingNotice />
        </>
      }
      viewerStandings={readViewerHouseholdAccess()}
    >
      {children}
    </AppShell>
  );
}
