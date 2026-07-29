"use client";

import type { TodayShortlistResponse } from "@tendnote/domain/today";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { appDestination } from "@/components/app-destinations";
import { CornerDownLeftIcon } from "@/components/icons";
import { TodayShortlist, type TodayShortlistHandlers } from "@/components/today-shortlist";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { requestLocalEveDraftSubmission, useLocalComposerDraft } from "@/lib/local-composer-draft";

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

function MobileTodayHome({
  eveDraftRevision,
  onOpenEve,
  ownerUserId,
  todayHandlers,
  todayInitial,
  todayLocalDate,
  todayTimeZone,
}: {
  eveDraftRevision: number;
  onOpenEve: (trigger: HTMLElement) => void;
  ownerUserId: string;
  todayHandlers: TodayShortlistHandlers;
  todayInitial: TodayShortlistResponse;
  todayLocalDate: string;
  todayTimeZone: string;
}) {
  return (
    <div className="min-h-dvh pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:hidden">
      <TodayEveComposer key={eveDraftRevision} onOpenEve={onOpenEve} ownerUserId={ownerUserId} />
      <TodayShortlist
        handlers={todayHandlers}
        initial={todayInitial}
        localDate={todayLocalDate}
        timeZone={todayTimeZone}
      />
    </div>
  );
}

function TodayEveComposer({
  onOpenEve,
  ownerUserId,
}: {
  onOpenEve: (trigger: HTMLElement) => void;
  ownerUserId: string;
}) {
  const draft = useLocalComposerDraft(ownerUserId, "eve");
  const submitButton = useRef<HTMLButtonElement>(null);
  const date = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(new Date());
  return (
    <div
      className="bg-panel px-5 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-6"
      data-testid="today-orientation-band"
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-[length:var(--text-h1)] leading-[var(--text-h1-line)]">
            {appDestination("today").label}
          </h1>
          <p className="mt-0.5 text-muted-foreground text-sm" suppressHydrationWarning>
            {date}
          </p>
        </div>
      </header>
      <form
        className="mt-6 flex min-h-28 w-full flex-col justify-between gap-3 rounded-xl border bg-background p-4 focus-within:ring-3 focus-within:ring-ring/40"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.value.trim()) {
            try {
              requestLocalEveDraftSubmission(window.localStorage, ownerUserId, draft.value);
            } catch {
              // Storage is best effort; the focused Eve surface still opens.
            }
          }
          onOpenEve(submitButton.current ?? event.currentTarget);
        }}
      >
        <label className="sr-only" htmlFor="today-eve-composer">
          Ask Eve anything
        </label>
        {/* The bordered form is the field; the control inside it stays chromeless
            so there is one box, not a box inside a box. It grows with the
            question up to a cap, then scrolls. */}
        <Textarea
          className="max-h-40 min-h-12 resize-none rounded-none border-0 bg-transparent p-0 focus-visible:ring-0 md:text-base dark:bg-transparent"
          id="today-eve-composer"
          onChange={(event) => draft.setValue(event.target.value)}
          placeholder="Ask Eve anything…"
          value={draft.value}
        />
        <span className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-xs">
            Questions stay conversational unless you ask to save.
          </span>
          <Button
            aria-label={draft.value.trim() ? "Send to Eve" : "Open Eve"}
            className="size-11"
            data-mobile-flow-trigger="eve"
            ref={submitButton}
            size="icon"
            type="submit"
          >
            <CornerDownLeftIcon aria-hidden className="size-4" />
          </Button>
        </span>
      </form>
    </div>
  );
}
