"use client";

import Link from "next/link";
import type { ViewerStandings } from "@/components/app-destinations";
import { AppNavigation, type AppNavigationRow } from "@/components/app-navigation";
import { TendnoteMark } from "@/components/tendnote-logo";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The shell's navigation on a canvas route, as a rail that is always icons.
 *
 * A canvas route brings its own sidebar, and exactly one `SidebarProvider` may
 * be mounted at a time (ADR 0239) — so this rail is not one. It is a plain
 * column: no provider, no context, no `Cmd+B`, and no `sidebar_state` of its
 * own. What it keeps is everything a reader needs from the rail it stands in for
 * — the same destinations from the same table, the same sage on the current one,
 * the same labels as tooltips, and the wordmark at its head as the way home — so
 * crossing into the Assistant costs a fold, not the whole of navigation.
 *
 * It is fixed at icon width rather than foldable because the fold is a
 * `SidebarProvider` affordance and because the route beside it already spends
 * the window on a transcript and a conversation list. `--tn-canvas-rail` is
 * that width, and the conversation rail reads the same token to know where the
 * window's left edge effectively is (`assistant-conversation-rail`).
 *
 * Below `lg` it is `display: none`, like the foldable rail: the phone shell's
 * bottom bar and Menu own navigation there.
 */
export function CanvasNavigationRail({ standings }: { standings: Promise<ViewerStandings> }) {
  return (
    <div className="hidden w-(--tn-canvas-rail) shrink-0 flex-col gap-2 border-r bg-sidebar px-2 py-2 text-sidebar-foreground lg:flex">
      {/* The layout's `TooltipProvider`, nested for the same reason the foldable
          rail nests one: a harness that mounts the shell without the root layout
          around it still renders. */}
      <TooltipProvider>
        {/* Named on the link, not by the mark: the wordmark this stands in for
            has no room here, and a link with only a decorative image inside it
            would have no accessible name at all. */}
        <Link
          aria-label="Tendnote"
          className="flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href="/"
        >
          <TendnoteMark className="size-7" />
        </Link>

        <AppNavigation standings={standings}>
          {({ primary, secondary }) => (
            <>
              <nav aria-label="Primary">
                <ul className="flex flex-col gap-1">
                  {primary.map((row) => (
                    <CanvasNavigationDestination key={row.destination.id} row={row} />
                  ))}
                </ul>
              </nav>

              {/* The same ruled shelf as the foldable rail's footer, pushed to
                  the foot of the column. `data-horizontal:w-auto` is the same
                  variant-specificity correction explained in `app-sidebar`. */}
              <div className="mt-auto flex flex-col gap-2">
                <SidebarSeparator className="mx-0 data-horizontal:w-auto" />
                <nav aria-label="Secondary">
                  <ul className="flex flex-col gap-1">
                    {secondary.map((row) => (
                      <CanvasNavigationDestination key={row.destination.id} row={row} />
                    ))}
                  </ul>
                </nav>
              </div>
            </>
          )}
        </AppNavigation>
      </TooltipProvider>
    </div>
  );
}

/**
 * One icon row, drawn to match a folded `SidebarMenuButton` — the same 32px
 * square, the same neutral `muted` hover, the same sage tint and `aria-current`
 * on the one you are in, and the label as a tooltip on hover or focus.
 *
 * The primitive itself cannot be reused: `SidebarMenuButton` calls `useSidebar`
 * for the tooltip it shows only while collapsed, so it throws outside a
 * provider, and the collapsed size it would take comes from a
 * `group-data-[collapsible=icon]` ancestor that does not exist here either.
 */
function CanvasNavigationDestination({ row: { current, destination } }: { row: AppNavigationRow }) {
  const Icon = destination.icon;
  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex size-8 items-center justify-center rounded-md text-muted-foreground outline-hidden ring-sidebar-ring transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 [&_svg]:size-4 [&_svg]:shrink-0",
              current && "bg-sidebar-accent font-medium text-foreground",
            )}
            href={destination.route}
          >
            <Icon aria-hidden />
            <span className="sr-only">{destination.label}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{destination.label}</TooltipContent>
      </Tooltip>
    </li>
  );
}
