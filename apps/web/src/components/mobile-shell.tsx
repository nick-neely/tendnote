"use client";

import type { TodayShortlistResponse } from "@tendnote/domain/today";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import {
  CornerDownLeftIcon,
  HomeIcon,
  ListChecksIcon,
  MenuIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/icons";
import type {
  CaptureHandlers,
  FocusedFlow,
  GlobalRecallHandler,
} from "@/components/mobile-focused-flows";
import { TodayShortlist, type TodayShortlistHandlers } from "@/components/today-shortlist";
import { useSession } from "@/lib/auth/client";
import { requestLocalEveDraftSubmission, useLocalComposerDraft } from "@/lib/local-composer-draft";
import { cn } from "@/lib/utils";

const SearchFlow = dynamic(
  () => import("@/components/mobile-focused-flows").then((mod) => mod.SearchFlow),
  { ssr: false },
);
const CaptureFlow = dynamic(
  () => import("@/components/mobile-focused-flows").then((mod) => mod.CaptureFlow),
  { ssr: false },
);
const EveFlow = dynamic(
  () => import("@/components/mobile-focused-flows").then((mod) => mod.EveFlow),
  {
    ssr: false,
  },
);
const MenuFlow = dynamic(
  () => import("@/components/mobile-focused-flows").then((mod) => mod.MenuFlow),
  {
    ssr: false,
  },
);

type MobileShellProps = {
  children: ReactNode;
  captureHandlers?: CaptureHandlers;
  mobileEve?: ReactNode;
  mobileDestination?: ReactNode;
  mobileHome: boolean;
  mobileReview: boolean;
  ownerUserId?: string;
  routeAwareMobileNavigation?: boolean;
  searchHandler: GlobalRecallHandler;
  todayHandlers: TodayShortlistHandlers;
  todayInitial: TodayShortlistResponse;
  todayLocalDate: string;
  todayTimeZone: string;
};

export function MobileShell(props: MobileShellProps) {
  if (!props.ownerUserId) return <SessionOwnedMobileShell {...props} />;
  return <MobileShellContent {...props} />;
}

function SessionOwnedMobileShell(props: MobileShellProps) {
  const session = useSession();
  const ownerUserId =
    session.data?.user.id ?? (process.env.NODE_ENV === "development" ? "demo-user" : undefined);
  return (
    <MobileShellContent {...props} key={ownerUserId ?? "unresolved"} ownerUserId={ownerUserId} />
  );
}

function MobileShellContent({
  children,
  captureHandlers,
  mobileEve,
  mobileDestination,
  mobileHome,
  mobileReview,
  ownerUserId = "",
  routeAwareMobileNavigation = false,
  searchHandler,
  todayHandlers,
  todayInitial,
  todayLocalDate,
  todayTimeZone,
}: MobileShellProps) {
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
    if (next !== "menu" && !ownerUserId) return;
    invokingControl.current = trigger;
    setFlow(next);
  }

  function closeFlow() {
    const trigger = invokingControl.current;
    const triggerKey = trigger?.dataset.mobileFlowTrigger;
    if (flow === "eve") setEveDraftRevision((revision) => revision + 1);
    setFlow(null);
    requestAnimationFrame(() => {
      const replacement = triggerKey
        ? document.querySelector<HTMLElement>(`[data-mobile-flow-trigger="${triggerKey}"]`)
        : null;
      (trigger?.isConnected ? trigger : replacement)?.focus();
    });
  }

  function closeFlowForNavigation() {
    setFlow(null);
  }

  return (
    <>
      {mobileDestination ??
        (mobileHome && !routeAwareMobileNavigation ? (
          <MobileTodayHome
            eveDraftRevision={eveDraftRevision}
            onOpenEve={(trigger) => openFlow("eve", trigger)}
            ownerUserId={ownerUserId}
            todayHandlers={todayHandlers}
            todayInitial={todayInitial}
            todayLocalDate={todayLocalDate}
            todayTimeZone={todayTimeZone}
          />
        ) : null)}
      {routeAwareMobileNavigation ? (
        <Suspense fallback={<MobileRouteMain>{children}</MobileRouteMain>}>
          <RouteAwareMobileMain>{children}</RouteAwareMobileMain>
        </Suspense>
      ) : (
        <MobileRouteMain mobileHome={mobileHome}>{children}</MobileRouteMain>
      )}
      {routeAwareMobileNavigation ? (
        <Suspense
          fallback={
            <MobileBottomBar
              hidden={flow !== null}
              mobileHome={false}
              mobileReview={false}
              onOpen={openFlow}
            />
          }
        >
          <RouteAwareMobileBottomBar hidden={flow !== null} onOpen={openFlow} />
        </Suspense>
      ) : (
        <MobileBottomBar
          hidden={flow !== null}
          mobileHome={mobileHome}
          mobileReview={mobileReview}
          onOpen={openFlow}
        />
      )}
      <MobileFocusedFlow
        captureHandlers={captureHandlers}
        flow={flow}
        mobileEve={mobileEve}
        onClose={closeFlow}
        onNavigate={closeFlowForNavigation}
        ownerUserId={ownerUserId}
        query={searchQuery}
        search={searchHandler}
        setQuery={setSearchQuery}
      />
    </>
  );
}

function MobileRouteMain({
  children,
  mobileHome = false,
}: {
  children: ReactNode;
  mobileHome?: boolean;
}) {
  return (
    <main
      className={cn(
        "w-full lg:mx-auto lg:flex lg:max-w-7xl lg:flex-col lg:gap-6 lg:px-6 lg:py-8",
        mobileHome
          ? "block"
          : "mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6",
      )}
    >
      {children}
    </main>
  );
}

function RouteAwareMobileMain({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mobileHome = pathname === "/" && searchParams.get("tab") !== "review";
  return <MobileRouteMain mobileHome={mobileHome}>{children}</MobileRouteMain>;
}

function RouteAwareMobileBottomBar({
  hidden,
  onOpen,
}: {
  hidden: boolean;
  onOpen: (flow: FocusedFlow, trigger: HTMLElement) => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mobileHome = pathname === "/" && searchParams.get("tab") !== "review";
  const mobileReview = pathname === "/" && searchParams.get("tab") === "review";
  return (
    <MobileBottomBar
      hidden={hidden}
      mobileHome={mobileHome}
      mobileReview={mobileReview}
      onOpen={onOpen}
    />
  );
}

function MobileFocusedFlow({
  captureHandlers,
  flow,
  mobileEve,
  onClose,
  onNavigate,
  ownerUserId,
  query,
  search,
  setQuery,
}: {
  captureHandlers?: CaptureHandlers;
  flow: FocusedFlow | null;
  mobileEve?: ReactNode;
  onClose: () => void;
  onNavigate: () => void;
  ownerUserId: string;
  query: string;
  search: GlobalRecallHandler;
  setQuery: (query: string) => void;
}) {
  switch (flow) {
    case "search":
      return (
        <SearchFlow
          onClose={onClose}
          onNavigate={onNavigate}
          ownerUserId={ownerUserId}
          query={query}
          search={search}
          setQuery={setQuery}
        />
      );
    case "capture":
      return <CaptureFlow handlers={captureHandlers} onClose={onClose} ownerUserId={ownerUserId} />;
    case "eve":
      return <EveFlow onClose={onClose}>{mobileEve}</EveFlow>;
    case "menu":
      return <MenuFlow onClose={onClose} />;
    default:
      return null;
  }
}

export function MobileTodayHome({
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
            Today
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
            data-mobile-flow-trigger="eve"
            ref={submitButton}
            type="submit"
          >
            <CornerDownLeftIcon aria-hidden className="size-4" />
          </button>
        </span>
      </form>
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
      data-mobile-flow-trigger={flow}
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
