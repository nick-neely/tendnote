import type { ReactNode } from "react";
import {
  addCapturePersonAction,
  captureExplicitOutcomeAction,
  changeExplicitCaptureOutcomeAction,
  changeExplicitCaptureReminderAction,
  undoExplicitCaptureOutcomeAction,
} from "@/app/actions/conversational-capture";
import { globalRecallAction } from "@/app/actions/global-recall";
import { NO_VIEWER_STANDINGS_RESOLVED, type ViewerStandings } from "@/components/app-destinations";
import { AppShellFrame } from "@/components/app-shell-frame";
import { AppSidebar } from "@/components/app-sidebar";
import type { CaptureHandlers, GlobalRecallHandler } from "@/components/mobile-focused-flows";
import { MobileShell } from "@/components/mobile-shell";
import { SearchPalette } from "@/components/search-palette";
import { ThemeToggle } from "@/components/theme-toggle";

const defaultCaptureHandlers: CaptureHandlers = {
  addPerson: addCapturePersonAction,
  change: changeExplicitCaptureOutcomeAction,
  changeReminder: changeExplicitCaptureReminderAction,
  submit: captureExplicitOutcomeAction,
  undo: undoExplicitCaptureOutcomeAction,
};

export function AppShell({
  canvas = false,
  captureHandlers = defaultCaptureHandlers,
  children,
  ownerUserId,
  searchHandler = globalRecallAction,
  /**
   * The viewer's conditional destinations, resolved by the admitted layout.
   *
   * A promise so the shell never awaits it: the rail, the phone bar, and the
   * destination itself all render first, and only the two navigation surfaces
   * that need a Household link wait behind their own boundaries.
   */
  viewerStandings = NO_VIEWER_STANDINGS_RESOLVED,
}: {
  /**
   * This route brings its own rail, so the shell mounts none (ADR 0239). Set by
   * the `(canvas)` layout, never guessed from the URL.
   */
  canvas?: boolean;
  captureHandlers?: CaptureHandlers;
  children: ReactNode;
  ownerUserId?: string;
  searchHandler?: GlobalRecallHandler;
  viewerStandings?: Promise<ViewerStandings>;
}) {
  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <AppShellFrame
        canvas={canvas}
        sidebar={<AppSidebar standings={viewerStandings} />}
        tools={
          <>
            {/* Search and appearance are tools, not destinations, so they stay
                in the header rather than becoming rows in the rail. The palette
                registers Cmd+K here, once for every admitted route, and stays
                inert below `lg` where the phone shell's Search flow owns
                recall. */}
            <SearchPalette ownerUserId={ownerUserId} search={searchHandler} />
            <ThemeToggle />
          </>
        }
      >
        <MobileShell
          captureHandlers={captureHandlers}
          ownerUserId={ownerUserId}
          searchHandler={searchHandler}
          viewerStandings={viewerStandings}
        >
          {children}
        </MobileShell>
      </AppShellFrame>
    </div>
  );
}
