"use client";

import type { EveApprovalMode } from "@tendnote/domain";
import type { TodayShortlistResponse } from "@tendnote/domain/today";
import type { UsageNotice } from "@tendnote/domain/usage-bounds";
import dynamic from "next/dynamic";
import { type ReactNode, useRef, useState } from "react";
import { appDestination } from "@/components/app-destinations";
import { AssistantUsageNotice } from "@/components/assistant-panel-chrome";
import { FirstRunSkipButton, FirstRunWelcome } from "@/components/first-run-welcome";
import { CornerDownLeftIcon } from "@/components/icons";
import { TodayShortlist, type TodayShortlistHandlers } from "@/components/today-shortlist";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BackgroundUsageNotice } from "@/components/usage-notice-card";
import type { BackgroundUsage } from "@/lib/assistant/usage-notice";
import {
  FIRST_RUN_QUESTION,
  FIRST_RUN_REPEAT_DETAIL,
  type FirstRunPrompt,
  firstRunPlaceholder,
} from "@/lib/first-run-copy";
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
  approvalMode = "ask",
  firstRun = null,
  integrationOffer = null,
  ownerUserId,
  todayHandlers,
  todayInitial,
  todayLocalDate,
  todayTimeZone,
  usage,
  backgroundUsage,
}: {
  /**
   * The owner's Approval Mode, read on the server by this route and passed to the
   * assistant flow this destination opens (#549).
   */
  approvalMode?: EveApprovalMode;
  /** What the first run asks of this render (#639). */
  firstRun?: FirstRunPrompt;
  /** The integrations offer, once First Value is reached (#639). */
  integrationOffer?: ReactNode;
  ownerUserId: string;
  todayHandlers: TodayShortlistHandlers;
  todayInitial: TodayShortlistResponse;
  todayLocalDate: string;
  todayTimeZone: string;
  /** Interactive Eve's usage notice, read server-side by the destination (#625). */
  usage?: UsageNotice;
  /** Background work's usage notice, shown on Today while it is paused. */
  backgroundUsage?: BackgroundUsage;
}) {
  const [eveOpen, setEveOpen] = useState(false);
  const [eveDraftRevision, setEveDraftRevision] = useState(0);
  const eveTrigger = useRef<HTMLElement | null>(null);

  return (
    <>
      <MobileTodayHome
        eveDraftRevision={eveDraftRevision}
        firstRun={firstRun}
        integrationOffer={integrationOffer}
        onOpenEve={(trigger) => {
          eveTrigger.current = trigger;
          setEveOpen(true);
        }}
        ownerUserId={ownerUserId}
        todayHandlers={todayHandlers}
        todayInitial={todayInitial}
        todayLocalDate={todayLocalDate}
        todayTimeZone={todayTimeZone}
        usage={usage}
        backgroundUsage={backgroundUsage}
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
          <EveSurface approvalMode={approvalMode} ownerUserId={ownerUserId} usage={usage} />
        </EveFlow>
      ) : null}
    </>
  );
}

function MobileTodayHome({
  eveDraftRevision,
  firstRun,
  integrationOffer,
  onOpenEve,
  ownerUserId,
  todayHandlers,
  todayInitial,
  todayLocalDate,
  todayTimeZone,
  usage,
  backgroundUsage,
}: {
  eveDraftRevision: number;
  firstRun: FirstRunPrompt;
  integrationOffer: ReactNode;
  onOpenEve: (trigger: HTMLElement) => void;
  ownerUserId: string;
  todayHandlers: TodayShortlistHandlers;
  todayInitial: TodayShortlistResponse;
  todayLocalDate: string;
  todayTimeZone: string;
  usage?: UsageNotice;
  backgroundUsage?: BackgroundUsage;
}) {
  return (
    <div className="min-h-dvh pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:hidden">
      <TodayEveComposer
        firstRun={firstRun}
        key={eveDraftRevision}
        onOpenEve={onOpenEve}
        ownerUserId={ownerUserId}
        usage={usage}
        backgroundUsage={backgroundUsage}
      />
      {integrationOffer ? <div className="px-gutter pt-6">{integrationOffer}</div> : null}
      {/* Skip lands here with the question repeated once, where Today's
          shortlist would otherwise say there is nothing yet (#639). */}
      {firstRun === "repeat" ? (
        <div className="px-gutter pt-6">
          <div className="flex flex-col gap-1 rounded-xl border bg-surface px-4 py-4">
            <p className="font-medium text-sm">{FIRST_RUN_QUESTION}</p>
            <p className="text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
              {FIRST_RUN_REPEAT_DETAIL}
            </p>
          </div>
        </div>
      ) : null}
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
  firstRun,
  onOpenEve,
  ownerUserId,
  usage,
  backgroundUsage,
}: {
  firstRun: FirstRunPrompt;
  onOpenEve: (trigger: HTMLElement) => void;
  ownerUserId: string;
  /** Shown under the composer while Eve is reduced or paused, so Today says so too (#626). */
  usage?: UsageNotice;
  /** Shown under it while background work is paused, which is why no brief arrived. */
  backgroundUsage?: BackgroundUsage;
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
      className="bg-panel px-gutter pt-[calc(1.25rem+env(safe-area-inset-top))] pb-6"
      data-testid="today-orientation-band"
    >
      {firstRun === "welcome" ? (
        <FirstRunWelcome variant="band" />
      ) : (
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
      )}
      <form
        className="mt-6 flex min-h-28 w-full flex-col justify-between gap-3 rounded-xl border bg-background p-4 focus-within:ring-3 focus-within:ring-ring/40"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.value.trim()) {
            try {
              requestLocalEveDraftSubmission(window.localStorage, ownerUserId, draft.value);
            } catch {
              // Storage is best effort; the focused assistant surface still opens.
            }
          }
          onOpenEve(submitButton.current ?? event.currentTarget);
        }}
      >
        <Label className="sr-only" htmlFor="today-eve-composer">
          Ask the assistant anything
        </Label>
        {/* The bordered form is the field; the control inside it stays chromeless
            so there is one box, not a box inside a box. It grows with the
            question up to a cap, then scrolls. */}
        <Textarea
          className="max-h-40 min-h-12 resize-none rounded-none border-0 bg-transparent p-0 focus-visible:ring-0 md:text-base dark:bg-transparent"
          id="today-eve-composer"
          onChange={(event) => draft.setValue(event.target.value)}
          placeholder={firstRunPlaceholder(firstRun) ?? "Ask the assistant anything…"}
          value={draft.value}
        />
        <span className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-xs">
            Questions stay conversational unless you ask to save.
          </span>
          <Button
            aria-label={draft.value.trim() ? "Send to the assistant" : "Open the assistant"}
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
      {firstRun === "welcome" ? <FirstRunSkipButton className="-ml-3 mt-2" /> : null}
      {usage && usage.state !== "normal" ? (
        <div className="mt-3">
          <AssistantUsageNotice notice={usage} />
        </div>
      ) : null}
      {backgroundUsage && backgroundUsage.background.state !== "normal" ? (
        <div className="mt-3">
          <BackgroundUsageNotice usage={backgroundUsage} />
        </div>
      ) : null}
    </div>
  );
}
