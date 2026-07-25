"use client";

import type { TodayShortlistResponse } from "@tendnote/domain/today";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { MobileTodayHome } from "@/components/mobile-shell";
import type { TodayShortlistHandlers } from "@/components/today-shortlist";

const EveFlow = dynamic(
  () => import("@/components/mobile-focused-flows").then((mod) => mod.EveFlow),
  {
    ssr: false,
  },
);
const EveSurface = dynamic(
  () => import("@/components/mobile-eve-surface").then((mod) => mod.EveSurface),
  { ssr: false },
);

/** Route-owned mobile Today surface, rendered inside the admitted application shell. */
export function MobileTodayDestination({
  ownerUserId,
  todayHandlers,
  todayInitial,
  todayLocalDate,
  todayTimeZone,
}: {
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
          <EveSurface ownerUserId={ownerUserId} />
        </EveFlow>
      ) : null}
    </>
  );
}
