"use client";

import type { TodayShortlistResponse } from "@tendnote/domain/today";
import { MessageSquareTextIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
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
  suppressTodayItemAction,
} from "@/app/actions/today";
import { appDestinations } from "@/components/app-destinations";
import { MobileFailureState } from "@/components/mobile-failure-state";
import type { CaptureHandlers, GlobalRecallHandler } from "@/components/mobile-focused-flows";
import { MobileShell } from "@/components/mobile-shell";
import { PwaRegistration } from "@/components/pwa-registration";
import { ReminderTimeZoneReconciler } from "@/components/reminder-time-zone-reconciler";
import type { TodayShortlistHandlers } from "@/components/today-shortlist";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useDeepLinkHighlight } from "@/lib/use-deep-link-highlight";

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
  mobileHome = false,
  mobileReview = false,
  ownerUserId,
  searchHandler = globalRecallAction,
  todayHandlers = defaultTodayHandlers,
  todayInitial = emptyToday,
  todayLocalDate = new Date().toISOString().slice(0, 10),
  todayTimeZone = "UTC",
}: {
  captureHandlers?: CaptureHandlers;
  children: ReactNode;
  mobileEve?: ReactNode;
  mobileHome?: boolean;
  mobileReview?: boolean;
  ownerUserId: string;
  searchHandler?: GlobalRecallHandler;
  todayHandlers?: TodayShortlistHandlers;
  todayInitial?: TodayShortlistResponse;
  todayLocalDate?: string;
  todayTimeZone?: string;
}) {
  const online = useOnlineState();
  useDeepLinkHighlight();

  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <PwaRegistration />
      <ReminderTimeZoneReconciler />
      <header className="sticky top-0 z-10 hidden border-b bg-background/95 backdrop-blur lg:block">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link className="flex items-center gap-2 font-semibold tracking-normal" href="/">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessageSquareTextIcon aria-hidden className="size-4" />
            </span>
            Tendnote
          </Link>
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
        </div>
      </header>

      {!online ? (
        <div className="px-4 pt-[calc(1rem+env(safe-area-inset-top))] lg:pt-4">
          <MobileFailureState kind="offline" onRetry={() => window.location.reload()} />
        </div>
      ) : null}

      <MobileShell
        captureHandlers={captureHandlers}
        mobileEve={mobileEve}
        mobileHome={mobileHome}
        mobileReview={mobileReview}
        ownerUserId={ownerUserId}
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

function useOnlineState() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
