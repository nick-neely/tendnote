"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { TendnoteLogo } from "@/components/tendnote-logo";
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
 * in `globals.css`). So the shell yields there: the navigation rail is not
 * mounted, the conversation rail is the only rail, and `Cmd+B` has exactly one
 * meaning on every route. The way back is the wordmark, which the header carries
 * on precisely the routes where the rail is not there to carry it.
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
  sidebar,
  tools,
}: {
  /** This route brings its own rail; the shell mounts no provider. See above. */
  canvas?: boolean;
  children: ReactNode;
  /** The navigation rail, mounted on every route the shell does not yield. */
  sidebar: ReactNode;
  /** Search and appearance: tools, not destinations, so they sit in the header. */
  tools: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (readFoldedPreference()) setOpen(false);
  }, []);

  if (canvas) {
    return (
      <>
        <ShellHeader lead={<WordmarkHome />} tools={tools} />
        {children}
      </>
    );
  }

  return (
    <SidebarProvider onOpenChange={setOpen} open={open}>
      {sidebar}
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
 * One preference for both rails, deliberately: they are never on screen at the
 * same time, and "I keep the left rail folded" is one habit rather than two.
 */
function readFoldedPreference(): boolean {
  return document.cookie.split("; ").some((entry) => entry === `${SIDEBAR_COOKIE_NAME}=false`);
}

/**
 * The slim bar above every destination: how to fold the rail, then the tools.
 *
 * Its height is load-bearing — the Assistant sizes its non-scrolling canvas
 * against `3.5rem` plus this border — so a change here is a change there.
 */
function ShellHeader({ lead, tools }: { lead: ReactNode; tools: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 hidden border-b bg-background/95 backdrop-blur lg:block">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        {lead}
        <div className="flex flex-1 items-center justify-end gap-1">{tools}</div>
      </div>
    </header>
  );
}

function WordmarkHome() {
  return (
    <Link
      className="flex w-fit items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      href="/"
    >
      <TendnoteLogo size="header" />
    </Link>
  );
}
