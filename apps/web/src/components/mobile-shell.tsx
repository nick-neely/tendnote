"use client";

import {
  CornerDownLeftIcon,
  HomeIcon,
  ListChecksIcon,
  MenuIcon,
  PlusIcon,
  RotateCwIcon,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  CaptureFlow,
  type CaptureHandlers,
  EveFlow,
  type FocusedFlow,
  type GlobalRecallHandler,
  MenuFlow,
  SearchFlow,
} from "@/components/mobile-focused-flows";
import { Button } from "@/components/ui/button";
import { requestLocalEveDraftSubmission, useLocalComposerDraft } from "@/lib/local-composer-draft";
import { cn } from "@/lib/utils";

export function MobileShell({
  children,
  captureHandlers,
  mobileEve,
  mobileHome,
  mobileReview,
  ownerUserId,
  searchHandler,
}: {
  captureHandlers?: CaptureHandlers;
  children: ReactNode;
  mobileEve?: ReactNode;
  mobileHome: boolean;
  mobileReview: boolean;
  ownerUserId: string;
  searchHandler: GlobalRecallHandler;
}) {
  const [flow, setFlow] = useState<FocusedFlow | null>(null);
  const [eveDraftRevision, setEveDraftRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const invokingControl = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const state = window.history.state as Record<string, unknown> | null;
    if (
      state?.tendnoteGlobalRecallOwner !== ownerUserId ||
      state.tendnoteGlobalRecallReturnUrl !== window.location.href
    ) {
      return;
    }
    const { tendnoteGlobalRecallOwner: _, tendnoteGlobalRecallReturnUrl: __, ...rest } = state;
    window.history.replaceState(rest, "", window.location.href);
    setFlow("search");
  }, [ownerUserId]);

  function openFlow(next: FocusedFlow, trigger: HTMLElement) {
    invokingControl.current = trigger;
    setFlow(next);
  }

  function closeFlow() {
    const trigger = invokingControl.current;
    if (flow === "eve") setEveDraftRevision((revision) => revision + 1);
    setFlow(null);
    requestAnimationFrame(() => trigger?.focus());
  }

  function closeFlowForNavigation() {
    setFlow(null);
  }

  return (
    <>
      {mobileHome ? (
        <MobileTodayHome
          key={eveDraftRevision}
          onOpenEve={(trigger) => openFlow("eve", trigger)}
          ownerUserId={ownerUserId}
        />
      ) : null}
      <main
        className={cn(
          "mx-auto w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:flex lg:pb-6 lg:py-8",
          mobileHome ? "hidden" : "flex",
        )}
      >
        {children}
      </main>
      <MobileBottomBar
        hidden={flow !== null}
        mobileHome={mobileHome}
        mobileReview={mobileReview}
        onOpen={openFlow}
      />
      {flow === "search" ? (
        <SearchFlow
          onClose={closeFlow}
          onNavigate={closeFlowForNavigation}
          ownerUserId={ownerUserId}
          query={searchQuery}
          search={searchHandler}
          setQuery={setSearchQuery}
        />
      ) : null}
      {flow === "capture" ? (
        <CaptureFlow handlers={captureHandlers} onClose={closeFlow} ownerUserId={ownerUserId} />
      ) : null}
      {flow === "eve" ? <EveFlow onClose={closeFlow}>{mobileEve}</EveFlow> : null}
      {flow === "menu" ? <MenuFlow onClose={closeFlow} /> : null}
    </>
  );
}

function MobileTodayHome({
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
    <div className="min-h-dvh pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:hidden">
      <div
        className="bg-panel px-5 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-6"
        data-testid="today-orientation-band"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-semibold text-[length:var(--text-h1)] leading-[var(--text-h1-line)]">
              Today
            </h1>
            <p className="mt-0.5 text-muted-foreground text-sm" suppressHydrationWarning>
              {date}
            </p>
          </div>
          <Button
            aria-label="Refresh Today"
            className="size-11"
            disabled
            size="icon-lg"
            variant="ghost"
          >
            <RotateCwIcon aria-hidden />
          </Button>
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
          <textarea
            className="min-h-12 w-full resize-none bg-transparent text-base outline-none placeholder:text-muted-foreground"
            id="today-eve-composer"
            onChange={(event) => draft.setValue(event.target.value)}
            placeholder="Ask Eve anything…"
            value={draft.value}
          />
          <span className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-xs">
              Questions stay conversational unless you ask to save.
            </span>
            <button
              aria-label={draft.value.trim() ? "Send to Eve" : "Open Eve"}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              ref={submitButton}
              type="submit"
            >
              <CornerDownLeftIcon aria-hidden className="size-4" />
            </button>
          </span>
        </form>
      </div>
      <section aria-label="Today shortlist" className="px-5 pt-6">
        <div className="mb-2">
          <h2 className="font-semibold text-sm">Worth your attention</h2>
          <p className="text-muted-foreground text-xs">Grounded reasons for today appear here.</p>
        </div>
        <div aria-label="Loading today's grounded items" className="divide-y" role="status">
          {[0, 1, 2].map((row) => (
            <div className="flex min-h-24 items-center gap-3 py-4" data-today-ledger-row key={row}>
              <span aria-hidden className="size-9 shrink-0 rounded-lg bg-secondary" />
              <span className="flex flex-1 flex-col gap-2">
                <span aria-hidden className="h-3 w-20 rounded bg-secondary" />
                <span aria-hidden className="h-4 w-4/5 rounded bg-secondary" />
                <span aria-hidden className="h-3 w-2/3 rounded bg-secondary" />
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MobileBottomBar({
  hidden,
  mobileHome,
  mobileReview,
  onOpen,
}: {
  hidden: boolean;
  mobileHome: boolean;
  mobileReview: boolean;
  onOpen: (flow: FocusedFlow, trigger: HTMLElement) => void;
}) {
  return (
    <nav
      aria-hidden={hidden || undefined}
      aria-label="Mobile primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 grid w-full grid-cols-5 border-t bg-background/98 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden",
        hidden && "hidden",
      )}
      hidden={hidden}
    >
      <MobileNavLink active={mobileHome} href="/" icon={HomeIcon} label="Today" />
      <MobileNavButton icon={SearchIcon} label="Search" onClick={onOpen} flow="search" />
      <MobileNavButton emphasized icon={PlusIcon} label="Capture" onClick={onOpen} flow="capture" />
      <MobileNavLink
        active={mobileReview}
        href="/?tab=review"
        icon={ListChecksIcon}
        label="Review"
      />
      <MobileNavButton icon={MenuIcon} label="Menu" onClick={onOpen} flow="menu" />
    </nav>
  );
}

const mobileNavClass =
  "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[length:var(--text-caption)] transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 motion-reduce:transition-none";

function MobileNavLink({
  active = false,
  href,
  icon: Icon,
  label,
}: {
  active?: boolean;
  href: string;
  icon: typeof HomeIcon;
  label: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(mobileNavClass, active ? "text-primary" : "text-muted-foreground")}
      href={href}
    >
      <Icon aria-hidden className="size-5" />
      <span>{label}</span>
    </Link>
  );
}

function MobileNavButton({
  emphasized = false,
  flow,
  icon: Icon,
  label,
  onClick,
}: {
  emphasized?: boolean;
  flow: FocusedFlow;
  icon: typeof HomeIcon;
  label: string;
  onClick: (flow: FocusedFlow, trigger: HTMLElement) => void;
}) {
  return (
    <button
      className={cn(
        mobileNavClass,
        "text-muted-foreground",
        emphasized && "font-medium text-foreground",
      )}
      onClick={(event) => onClick(flow, event.currentTarget)}
      type="button"
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-lg",
          emphasized && "bg-primary text-primary-foreground",
        )}
      >
        <Icon aria-hidden className="size-5" />
      </span>
      <span>{label}</span>
    </button>
  );
}
