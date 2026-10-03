import { AppShell } from "@/components/app-shell";
import { BillingNotice } from "@/components/billing/billing-notice";
import { ServiceNotice } from "@/components/service-notice-banner";
import { readViewerHouseholdAccess } from "@/lib/household/viewer-household-access";

/** Every admitted destination except the canvas one: the navigation rail shell. */
export default function AdmittedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Started here and handed down unawaited, so the shell and the
          destination render at once and only the two navigation surfaces that
          can show a Household link wait for the membership read. */}
      <AppShell
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
    </>
  );
}
