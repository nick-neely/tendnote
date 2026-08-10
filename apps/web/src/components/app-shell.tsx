import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import {
  addCapturePersonAction,
  captureExplicitOutcomeAction,
  changeExplicitCaptureOutcomeAction,
  changeExplicitCaptureReminderAction,
  undoExplicitCaptureOutcomeAction,
} from "@/app/actions/conversational-capture";
import { globalRecallAction } from "@/app/actions/global-recall";
import { NO_VIEWER_STANDINGS_RESOLVED, type ViewerStandings } from "@/components/app-destinations";
import {
  DesktopAppNavigationFallback,
  DesktopAppNavigationForViewer,
} from "@/components/desktop-app-navigation";
import type { CaptureHandlers, GlobalRecallHandler } from "@/components/mobile-focused-flows";
import { MobileShell } from "@/components/mobile-shell";
import { SearchPalette } from "@/components/search-palette";
import { TendnoteLogo } from "@/components/tendnote-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";

const defaultCaptureHandlers: CaptureHandlers = {
  addPerson: addCapturePersonAction,
  change: changeExplicitCaptureOutcomeAction,
  changeReminder: changeExplicitCaptureReminderAction,
  submit: captureExplicitOutcomeAction,
  undo: undoExplicitCaptureOutcomeAction,
};

export function AppShell({
  captureHandlers = defaultCaptureHandlers,
  children,
  ownerUserId,
  searchHandler = globalRecallAction,
  /**
   * The viewer's conditional destinations, resolved by the admitted layout.
   *
   * A promise so the shell never awaits it: the header, the phone bar, and the
   * destination itself all render first, and only the two navigation surfaces
   * that need a Household link wait behind their own boundaries.
   */
  viewerStandings = NO_VIEWER_STANDINGS_RESOLVED,
}: {
  captureHandlers?: CaptureHandlers;
  children: ReactNode;
  ownerUserId?: string;
  searchHandler?: GlobalRecallHandler;
  viewerStandings?: Promise<ViewerStandings>;
}) {
  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <header className="sticky top-0 z-10 hidden border-b bg-background/95 backdrop-blur lg:block">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            className="flex w-fit items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href="/"
          >
            <TendnoteLogo size="header" />
          </Link>
          <div className="flex items-center gap-1">
            <Suspense fallback={<DesktopAppNavigationFallback />}>
              <DesktopAppNavigationForViewer standings={viewerStandings} />
            </Suspense>
            <Separator className="mx-1 h-5" orientation="vertical" />
            {/* Search and appearance are tools, not destinations, so they sit
                with each other on the far side of the rule rather than becoming
                a seventh item in Primary. The palette registers Cmd+K here, once
                for every admitted route, and stays inert below `lg` where the
                phone shell's Search flow owns recall. */}
            <SearchPalette ownerUserId={ownerUserId} search={searchHandler} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <MobileShell
        captureHandlers={captureHandlers}
        ownerUserId={ownerUserId}
        searchHandler={searchHandler}
        viewerStandings={viewerStandings}
      >
        {children}
      </MobileShell>
      <Separator className="hidden lg:block" />
    </div>
  );
}
