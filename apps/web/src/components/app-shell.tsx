"use client";

import { MessageSquareTextIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import {
  addCapturePersonAction,
  captureExplicitOutcomeAction,
  changeExplicitCaptureOutcomeAction,
  undoExplicitCaptureOutcomeAction,
} from "@/app/actions/conversational-capture";
import { appDestinations } from "@/components/app-destinations";
import { MobileFailureState } from "@/components/mobile-failure-state";
import type { CaptureHandlers } from "@/components/mobile-focused-flows";
import { MobileShell } from "@/components/mobile-shell";
import { PwaRegistration } from "@/components/pwa-registration";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const defaultCaptureHandlers: CaptureHandlers = {
  addPerson: addCapturePersonAction,
  change: changeExplicitCaptureOutcomeAction,
  submit: captureExplicitOutcomeAction,
  undo: undoExplicitCaptureOutcomeAction,
};

export function AppShell({
  captureHandlers = defaultCaptureHandlers,
  children,
  mobileEve,
  mobileHome = false,
  mobileReview = false,
  ownerUserId,
}: {
  captureHandlers?: CaptureHandlers;
  children: ReactNode;
  mobileEve?: ReactNode;
  mobileHome?: boolean;
  mobileReview?: boolean;
  ownerUserId: string;
}) {
  const online = useOnlineState();

  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <PwaRegistration />
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
