"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { use } from "react";
import {
  appDestination,
  destinationsInGroup,
  isDestinationCurrentInGroup,
  type ViewerStandings,
} from "@/components/app-destinations";
import { Button } from "@/components/ui/button";

/**
 * Primary navigation once the viewer's standings have arrived.
 *
 * The shell hands down a promise rather than an awaited value so the header can
 * render immediately and only this nav waits — a membership read must never
 * delay the destination the member came for.
 */
export function DesktopAppNavigationForViewer({
  standings,
}: {
  standings: Promise<ViewerStandings>;
}) {
  return <DesktopAppNavigation householdMember={use(standings).householdMember} />;
}

function DesktopAppNavigation({ householdMember = false }: { householdMember?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewer = { householdMember };
  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      {destinationsInGroup("desktop-primary", viewer).map((item) => {
        const Icon = item.icon;
        const active = isDestinationCurrentInGroup(
          item.id,
          "desktop-primary",
          pathname,
          searchParams,
          viewer,
        );
        return (
          <Button asChild key={item.id} variant="ghost">
            <Link aria-current={active ? "page" : undefined} href={appDestination(item.id).route}>
              <Icon aria-hidden data-icon="inline-start" />
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

/**
 * Stable primary-navigation geometry while route-aware current state resolves.
 *
 * It renders the destinations every viewer has and none of the conditional ones,
 * so a member without a household never sees a Household link appear and vanish.
 * A member with one gains a link as their standing resolves, which is the honest
 * direction for a reserve to be wrong in.
 */
export function DesktopAppNavigationFallback() {
  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      {destinationsInGroup("desktop-primary").map((item) => {
        const Icon = item.icon;
        return (
          <Button asChild key={item.id} variant="ghost">
            <Link href={appDestination(item.id).route}>
              <Icon aria-hidden data-icon="inline-start" />
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
