"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, use } from "react";
import {
  type AppDestination,
  type DestinationGroup,
  destinationsInGroup,
  isDestinationCurrentInGroup,
  type ViewerStandings,
} from "@/components/app-destinations";
import { TendnoteLogo } from "@/components/tendnote-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The shell's standing navigation rail (#552).
 *
 * It is the shadcn Sidebar the Assistant's conversation rail already uses, for
 * the same reasons and with the same palette: `--sidebar-*` in `globals.css`
 * point at Tendnote's own `panel`, hairline `border`, and sage `primary`, so the
 * two rails are visibly one idea rather than two rails that happen to be on the
 * same screen. Folded it is an icon rail, not a rail that disappears, and each
 * row keeps its label as a tooltip.
 *
 * Rows come from `app-destinations` and nowhere else, so the rail, the phone
 * Menu, and the command palette cannot drift into offering different sets. The
 * split between the standing group and the shelf at the foot is the table's own
 * `sidebar-primary` / `sidebar-secondary`, not a slice of one list here.
 *
 * Below `lg` this whole subtree is `display: none` and the phone shell's bottom
 * bar and Menu own navigation — see `app-shell-frame`, which is also where the
 * rail's one-provider rule lives.
 */
export function AppSidebar({ standings }: { standings: Promise<ViewerStandings> }) {
  return (
    // `lg:contents` rather than a breakpoint in JavaScript: below `lg` the phone
    // shell owns navigation, and the rail must not also exist there as the
    // primitive's mobile sheet — a second Menu with the same links in it. At
    // `lg` the wrapper disappears from layout so the rail is the provider's own
    // flex child again.
    //
    // The `TooltipProvider` is the root layout's, nested: it costs a context and
    // it keeps the shell renderable on its own, which is what a harness mounting
    // `AppShell` without the layout around it gets.
    <div className="hidden lg:contents">
      <TooltipProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="p-2">
            {/* The name is on the link, not only in the wordmark: folded, the
                wordmark is `display: none` and a link named by it would have no
                accessible name at all. */}
            <Link
              aria-label="Tendnote"
              className="flex h-8 items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 group-data-[collapsible=icon]:justify-center"
              href="/"
            >
              <TendnoteLogo
                size="header"
                wordmarkClassName="group-data-[collapsible=icon]:hidden"
              />
            </Link>
          </SidebarHeader>

          {/*
           * One boundary over both groups, because both need the same two facts:
           * whether the viewer still holds a household, and where they are. The
           * reserve renders the destinations every viewer has and marks none of
           * them current, so a member without a household never sees a Household
           * row appear and vanish, and the rail's geometry never moves.
           */}
          <Suspense fallback={<AppSidebarBody />}>
            <AppSidebarBodyForViewer standings={standings} />
          </Suspense>

          {/* The drag/click edge for the fold. `aria-hidden` because it is a
            second control with the same name as the header trigger and the same
            effect: a pointer affordance, already unreachable by keyboard. */}
          <SidebarRail aria-hidden />
        </Sidebar>
      </TooltipProvider>
    </div>
  );
}

function AppSidebarBodyForViewer({ standings }: { standings: Promise<ViewerStandings> }) {
  const householdMember = use(standings).householdMember;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return <AppSidebarBody householdMember={householdMember} location={{ pathname, searchParams }} />;
}

type Location = { pathname: string; searchParams: Pick<URLSearchParams, "get"> };

function AppSidebarBody({
  householdMember = false,
  location,
}: {
  householdMember?: boolean;
  location?: Location;
}) {
  const viewer = { householdMember };
  const current = (destination: AppDestination, group: DestinationGroup) =>
    location !== undefined &&
    isDestinationCurrentInGroup(
      destination.id,
      group,
      location.pathname,
      location.searchParams,
      viewer,
    );

  return (
    <>
      <SidebarContent>
        <nav aria-label="Primary">
          <SidebarGroup className="py-1">
            <SidebarGroupContent>
              <SidebarMenu>
                {destinationsInGroup("sidebar-primary", viewer).map((destination) => (
                  <AppSidebarDestination
                    current={current(destination, "sidebar-primary")}
                    destination={destination}
                    key={destination.id}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter className="gap-0 p-0">
        <SidebarSeparator className="mx-2" />
        <nav aria-label="Secondary">
          <SidebarGroup className="py-1">
            <SidebarGroupContent>
              <SidebarMenu>
                {destinationsInGroup("sidebar-secondary", viewer).map((destination) => (
                  <AppSidebarDestination
                    current={current(destination, "sidebar-secondary")}
                    destination={destination}
                    key={destination.id}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarFooter>
    </>
  );
}

/**
 * One row. Sage marks the current destination and nothing else — hover is the
 * neutral `muted` the conversation rail already uses — and the tooltip is the
 * label the icon rail no longer has room to print.
 */
function AppSidebarDestination({
  current,
  destination,
}: {
  current: boolean;
  destination: AppDestination;
}) {
  const Icon = destination.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        className="h-9 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)] hover:bg-muted hover:text-foreground data-active:text-foreground"
        isActive={current}
        tooltip={destination.label}
      >
        <Link aria-current={current ? "page" : undefined} href={destination.route}>
          <Icon aria-hidden />
          <span>{destination.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
