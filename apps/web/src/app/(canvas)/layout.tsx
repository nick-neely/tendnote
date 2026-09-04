import { AdmittedFrame } from "@/components/admitted-frame";
import { AppShell } from "@/components/app-shell";
import { readViewerHouseholdAccess } from "@/lib/household/viewer-household-access";

/**
 * The shell for a destination that takes the whole window and brings its own
 * rail — today only the Assistant.
 *
 * Same admission gate and same phone shell as `(admitted)`; what it drops is the
 * navigation rail, because exactly one `SidebarProvider` may be mounted at a
 * time (ADR 0239). Membership still comes down for the phone Menu, which is
 * unchanged here.
 */
export default function CanvasLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdmittedFrame>
      <AppShell canvas viewerStandings={readViewerHouseholdAccess()}>
        {children}
      </AppShell>
    </AdmittedFrame>
  );
}
