"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { ViewerStandings } from "@/components/app-destinations";
import { AppSidebar } from "@/components/app-sidebar";
import { CanvasNavigationRail } from "@/components/canvas-navigation-rail";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

/**
 * The desktop frame: one navigation rail, one header, and the rule that decides
 * which of the two rails in this product is mounted (#552, ADR 0239).
 *
 * ## Exactly one `SidebarProvider`
 *
 * The shadcn Sidebar is kept verbatim, and one provider owns two singletons: the
 * `Cmd/Ctrl+B` window shortcut, and the `sidebar_state` cookie it writes on every
 * fold. Two mounted providers therefore double-bind the keystroke — one press
 * folds both rails, and both write the cookie on the same event, so whichever
 * writes last decides what the other one remembers.
 *
 * `/assistant` already owns its own provider for the conversation rail, and it
 * is already the one destination that takes the whole window (`data-full-bleed`
 * in `globals.css`). So the shell's provider yields there. What it does not
 * yield is navigation: the same destinations stay on screen as a fixed icon rail
 * that is no provider at all (`canvas-navigation-rail`), so `Cmd+B` still has
 * exactly one meaning on every route and every destination is still one click
 * away from the Assistant.
 *
 * Which shape a route gets is a `canvas` prop from its layout — the `(canvas)`
 * route group — rather than a pathname read here. `usePathname` is a dynamic
 * hook: reading it above `children` would put every admitted route's static
 * shell behind a Suspense boundary under `cacheComponents`, which is the
 * partial-prefetching frame the admitted layout exists to prerender.
 *
 * ## Why the fold is corrected on the client
 *
 * shadcn reads `sidebar_state` in the layout and hands it down as `defaultOpen`.
 * The admitted layout cannot: it is prerendered owner-neutral for partial
 * prefetching, and under `cacheComponents` a `cookies()` read there would make
 * the whole frame dynamic. So the frame renders open, reads the cookie once on
 * mount, and folds if that is what the member left. The admitted frame is
 * `display: none` until the admission marker streams (`globals.css`), so the
 * correction lands behind that gate rather than in front of the reader.
 */
export function AppShellFrame({
  canvas = false,
  children,
  standings,
  tools,
}: {
  /** This route brings its own rail; the shell mounts no provider. See above. */
  canvas?: boolean;
  children: ReactNode;
  /** The viewer's conditional destinations, unwrapped inside whichever rail. */
  standings: Promise<ViewerStandings>;
  /** Search and appearance: tools, not destinations, so they sit in the header. */
  tools: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (readFoldedPreference()) setOpen(false);
  }, []);

  if (canvas) {
    // The same two columns as below, with a rail that cannot fold in place of
    // the one that can. `min-h-dvh` is what gives the rail the window's height,
    // the way the provider's own wrapper does for the foldable one.
    return (
      <div className="flex min-h-dvh w-full">
        <CanvasNavigationRail standings={standings} />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <ShellHeader tools={tools} />
          {children}
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider onOpenChange={setOpen} open={open}>
      <AppSidebar standings={standings} />
      {/* Not `SidebarInset`: that renders a `<main>`, and the phone shell below
          already renders the one `<main>` every destination paints into. Two
          landmarks, and `main:has(> [data-full-bleed])` matching the outer one,
          is what this div avoids. */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <ShellHeader
          lead={
            /* Named for what it reveals rather than for the fold state, the way
               the Assistant's rail trigger is, so it is never a control whose
               label changes under the pointer. */
            <SidebarTrigger aria-label="Navigation" className="text-muted-foreground" />
          }
          tools={tools}
        />
        {children}
      </div>
    </SidebarProvider>
  );
}

const SIDEBAR_COOKIE_NAME = "sidebar_state";

/**
 * Whether the member left a rail folded, from the cookie the primitive writes.
 *
 * One preference for both rails, deliberately: they are never both foldable at
 * once, and "I keep the left rail folded" is one habit rather than two.
 */
function readFoldedPreference(): boolean {
  return document.cookie.split("; ").some((entry) => entry === `${SIDEBAR_COOKIE_NAME}=false`);
}

/**
 * The slim bar above every destination: how to fold the rail, then the tools.
 *
 * Its height is load-bearing — the Assistant sizes its non-scrolling canvas
 * against `3.5rem` plus this border — so a change here is a change there.
 *
 * There is no lead on a canvas route, because there is no fold there and the
 * wordmark it used to carry is back at the head of the rail beside it, which is
 * where the wordmark is on every other route too.
 */
function ShellHeader({ lead, tools }: { lead?: ReactNode; tools: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 hidden border-b bg-background/95 backdrop-blur lg:block">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        {lead}
        <div className="flex flex-1 items-center justify-end gap-1">{tools}</div>
      </div>
    </header>
  );
}
