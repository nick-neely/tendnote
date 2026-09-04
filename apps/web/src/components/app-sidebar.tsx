"use client";

import Link from "next/link";
import type { ViewerStandings } from "@/components/app-destinations";
import { AppNavigation, type AppNavigationRow } from "@/components/app-navigation";
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
 * Rows come from `app-navigation` and so from `app-destinations` and nowhere
 * else, which is also what keeps this rail and the canvas icon rail beside the
 * Assistant offering one set. The split between the standing group and the shelf
 * at the foot is the table's own `sidebar-primary` / `sidebar-secondary`, not a
 * slice of one list here.
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

          <AppNavigation standings={standings}>
            {({ primary, secondary }) => (
              <>
                <SidebarContent>
                  <nav aria-label="Primary">
                    <SidebarGroup className="py-1">
                      <SidebarGroupContent>
                        <SidebarMenu>
                          {primary.map((row) => (
                            <AppSidebarDestination key={row.destination.id} row={row} />
                          ))}
                        </SidebarMenu>
                      </SidebarGroupContent>
                    </SidebarGroup>
                  </nav>
                </SidebarContent>

                {/* `pb-2` so the last row clears the window edge by the same
                    8px the wordmark clears the top by. */}
                <SidebarFooter className="gap-0 p-0 pb-2">
                  {/* `data-horizontal:w-auto` is load-bearing and fails as an
                      8px hairline poking out of the rail's right edge. The
                      primitive asks for `w-auto` in a plain class, and the
                      `Separator` beneath it sets `data-horizontal:w-full` in a
                      variant one — same specificity, variant emitted later, so
                      the plain class silently loses. Answering in the same
                      variant is what settles it. */}
                  <SidebarSeparator className="mx-2 data-horizontal:w-auto" />
                  <nav aria-label="Secondary">
                    <SidebarGroup className="py-1">
                      <SidebarGroupContent>
                        <SidebarMenu>
                          {secondary.map((row) => (
                            <AppSidebarDestination key={row.destination.id} row={row} />
                          ))}
                        </SidebarMenu>
                      </SidebarGroupContent>
                    </SidebarGroup>
                  </nav>
                </SidebarFooter>
              </>
            )}
          </AppNavigation>

          {/* The drag/click edge for the fold. `aria-hidden` because it is a
            second control with the same name as the header trigger and the same
            effect: a pointer affordance, already unreachable by keyboard. */}
          <SidebarRail aria-hidden />
        </Sidebar>
      </TooltipProvider>
    </div>
  );
}

/**
 * One row. Sage marks the current destination and nothing else — hover is the
 * neutral `muted` the conversation rail already uses — and the tooltip is the
 * label the icon rail no longer has room to print.
 */
function AppSidebarDestination({ row: { current, destination } }: { row: AppNavigationRow }) {
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
