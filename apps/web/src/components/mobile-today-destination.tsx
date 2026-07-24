"use client";

import type { TodayShortlistResponse } from "@tendnote/domain/today";
import { type ReactNode, useRef, useState } from "react";
import { EveFlow } from "@/components/mobile-focused-flows";
import { MobileTodayHome } from "@/components/mobile-shell";
import type { TodayShortlistHandlers } from "@/components/today-shortlist";

/** Route-owned mobile Today surface, rendered inside the admitted application shell. */
export function MobileTodayDestination({
  mobileEve,
  ownerUserId,
  todayHandlers,
  todayInitial,
  todayLocalDate,
  todayTimeZone,
}: {
  mobileEve: ReactNode;
  ownerUserId: string;
  todayHandlers: TodayShortlistHandlers;
  todayInitial: TodayShortlistResponse;
  todayLocalDate: string;
  todayTimeZone: string;
}) {
  const [eveOpen, setEveOpen] = useState(false);
  const [eveDraftRevision, setEveDraftRevision] = useState(0);
  const eveTrigger = useRef<HTMLElement | null>(null);

  return (
    <>
      <MobileTodayHome
        eveDraftRevision={eveDraftRevision}
        onOpenEve={(trigger) => {
          eveTrigger.current = trigger;
          setEveOpen(true);
        }}
        ownerUserId={ownerUserId}
        todayHandlers={todayHandlers}
        todayInitial={todayInitial}
        todayLocalDate={todayLocalDate}
        todayTimeZone={todayTimeZone}
      />
      {eveOpen ? (
        <EveFlow
          onClose={() => {
            const trigger = eveTrigger.current;
            setEveOpen(false);
            setEveDraftRevision((revision) => revision + 1);
            requestAnimationFrame(() => {
              const replacement = document.querySelector<HTMLElement>(
                '[data-mobile-flow-trigger="eve"]',
              );
              (trigger?.isConnected ? trigger : replacement)?.focus();
            });
          }}
        >
          {mobileEve}
        </EveFlow>
      ) : null}
    </>
  );
}
