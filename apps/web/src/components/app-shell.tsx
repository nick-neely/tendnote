import type { TodayShortlistResponse } from "@tendnote/domain/today";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  addCapturePersonAction,
  captureExplicitOutcomeAction,
  changeExplicitCaptureOutcomeAction,
  changeExplicitCaptureReminderAction,
  undoExplicitCaptureOutcomeAction,
} from "@/app/actions/conversational-capture";
import { globalRecallAction } from "@/app/actions/global-recall";
import {
  actOnTodayItemAction,
  refreshTodayAction,
  restoreTodayItemAction,
  suppressTodayItemAction,
} from "@/app/actions/today";
import { appDestinations } from "@/components/app-destinations";
import type { CaptureHandlers, GlobalRecallHandler } from "@/components/mobile-focused-flows";
import { MobileShell } from "@/components/mobile-shell";
import { TendnoteLogo } from "@/components/tendnote-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import type { TodayShortlistHandlers } from "@/components/today-shortlist";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const defaultCaptureHandlers: CaptureHandlers = {
  addPerson: addCapturePersonAction,
  change: changeExplicitCaptureOutcomeAction,
  changeReminder: changeExplicitCaptureReminderAction,
  submit: captureExplicitOutcomeAction,
  undo: undoExplicitCaptureOutcomeAction,
};

const defaultTodayHandlers: TodayShortlistHandlers = {
  act: actOnTodayItemAction,
  refresh: refreshTodayAction,
  restore: restoreTodayItemAction,
  suppress: suppressTodayItemAction,
};

const emptyToday: TodayShortlistResponse = {
  items: [],
  candidateFingerprint: "",
  curation: "deterministic",
  overflow: null,
  limitations: [],
};

export function AppShell({
  captureHandlers = defaultCaptureHandlers,
  children,
  mobileEve,
  mobileDestination,
  mobileHome = false,
  mobileReview = false,
  ownerUserId,
  routeAwareMobileNavigation = false,
  searchHandler = globalRecallAction,
  todayHandlers = defaultTodayHandlers,
  todayInitial = emptyToday,
  todayLocalDate = "1970-01-01",
  todayTimeZone = "UTC",
}: {
  captureHandlers?: CaptureHandlers;
  children: ReactNode;
  mobileEve?: ReactNode;
  mobileDestination?: ReactNode;
  mobileHome?: boolean;
  mobileReview?: boolean;
  ownerUserId?: string;
  routeAwareMobileNavigation?: boolean;
  searchHandler?: GlobalRecallHandler;
  todayHandlers?: TodayShortlistHandlers;
  todayInitial?: TodayShortlistResponse;
  todayLocalDate?: string;
  todayTimeZone?: string;
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
            <nav aria-label="Primary" className="flex items-center gap-1">
              {appDestinations.map((item) => {
                const Icon = item.icon;
                return (
                  <Button asChild key={item.href} variant="ghost">
                    <Link href={item.href}>
                      <Icon aria-hidden data-icon="inline-start" />
                      {item.label}
                    </Link>
                  </Button>
                );
              })}
            </nav>
            <Separator className="mx-1 h-5" orientation="vertical" />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <MobileShell
        captureHandlers={captureHandlers}
        mobileEve={mobileEve}
        mobileDestination={mobileDestination}
        mobileHome={mobileHome}
        mobileReview={mobileReview}
        ownerUserId={ownerUserId}
        routeAwareMobileNavigation={routeAwareMobileNavigation}
        searchHandler={searchHandler}
        todayHandlers={todayHandlers}
        todayInitial={todayInitial}
        todayLocalDate={todayLocalDate}
        todayTimeZone={todayTimeZone}
      >
        {children}
      </MobileShell>
      <Separator className="hidden lg:block" />
    </div>
  );
}
