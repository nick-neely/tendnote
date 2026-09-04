"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, use } from "react";
import {
  type AppDestination,
  type DestinationGroup,
  destinationsInGroup,
  isDestinationCurrentInGroup,
  type ViewerStandings,
} from "@/components/app-destinations";

/** One navigable row: where it goes, and whether the viewer is already there. */
export type AppNavigationRow = { destination: AppDestination; current: boolean };

/**
 * The two groups the shell's navigation shows, resolved for one viewer at one
 * location: the standing rows, and the quiet shelf beneath them.
 */
export type AppNavigationGroups = {
  primary: AppNavigationRow[];
  secondary: AppNavigationRow[];
};

type Location = { pathname: string; searchParams: Pick<URLSearchParams, "get"> };

function groupRows(
  group: DestinationGroup,
  viewer: { householdMember: boolean },
  location: Location | undefined,
): AppNavigationRow[] {
  return destinationsInGroup(group, viewer).map((destination) => ({
    destination,
    // No location means the reserve below, which marks nothing current rather
    // than guessing at a row and having to take the sage back.
    current:
      location !== undefined &&
      isDestinationCurrentInGroup(
        destination.id,
        group,
        location.pathname,
        location.searchParams,
        viewer,
      ),
  }));
}

function navigationGroups(householdMember = false, location?: Location): AppNavigationGroups {
  const viewer = { householdMember };
  return {
    primary: groupRows("sidebar-primary", viewer, location),
    secondary: groupRows("sidebar-secondary", viewer, location),
  };
}

/**
 * Which destinations the shell's navigation offers, and which one is current.
 *
 * The product draws that navigation twice — the foldable rail on most routes,
 * and the fixed icon rail on a canvas route that brings its own rail (ADR 0239)
 * — and the two differ only in chrome. Everything a reader could see them
 * disagree about lives here instead: the groups (from `app-destinations`, the
 * one table), the Household gate, and which row carries the sage.
 *
 * It is a render prop rather than two components because the shared part is not
 * markup. Each rail owns its own elements down to the row, and neither can wrap
 * the other's.
 *
 * ## Why the boundary is here and covers both groups
 *
 * Membership is streamed as a promise so the destination never waits on it, and
 * both groups need the same two facts — whether the viewer still holds a
 * household, and where they are — so one boundary answers both. The reserve
 * renders every destination a viewer has unconditionally and marks none of them
 * current, so a member without a household never sees a Household row appear and
 * vanish. A member with one gains a row as their standing resolves, which is the
 * honest direction for a reserve to be wrong in.
 */
export function AppNavigation({
  children,
  standings,
}: {
  children: (groups: AppNavigationGroups) => ReactNode;
  standings: Promise<ViewerStandings>;
}) {
  return (
    <Suspense fallback={children(navigationGroups())}>
      <ResolvedAppNavigation standings={standings}>{children}</ResolvedAppNavigation>
    </Suspense>
  );
}

function ResolvedAppNavigation({
  children,
  standings,
}: {
  children: (groups: AppNavigationGroups) => ReactNode;
  standings: Promise<ViewerStandings>;
}) {
  const householdMember = use(standings).householdMember;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return children(navigationGroups(householdMember, { pathname, searchParams }));
}
