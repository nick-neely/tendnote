"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { appDestination, homePanelForLocation } from "@/components/app-destinations";
import { type HomeIcon, MenuIcon, PlusIcon, SearchIcon } from "@/components/icons";
import type {
  CaptureHandlers,
  FocusedFlow,
  GlobalRecallHandler,
} from "@/components/mobile-focused-flows";
import { useSession } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

const SearchFlow = dynamic(
  () => import("@/components/mobile-focused-flows").then((mod) => mod.SearchFlow),
  { ssr: false },
);
const CaptureFlow = dynamic(
  () => import("@/components/mobile-focused-flows").then((mod) => mod.CaptureFlow),
  { ssr: false },
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
  ownerUserId?: string;
  searchHandler: GlobalRecallHandler;
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
  ownerUserId = "",
  searchHandler,
}: MobileShellProps) {
  const focused = useFocusedFlow(ownerUserId);
  const [searchQuery, setSearchQuery] = useState("");
  const { flow, open: openFlow } = focused;

  return (
    <>
      {/* One `<main>`, always. A destination that wants the full-bleed narrow
          canvas marks its own subtree with `data-mobile-bleed` (see globals.css)
          instead of the shell resolving the destination from the URL. */}
      <MobileRouteMain>{children}</MobileRouteMain>
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
      <MobileFocusedFlow
        captureHandlers={captureHandlers}
        flow={flow}
        onClose={focused.close}
        onNavigate={focused.closeForNavigation}
        ownerUserId={ownerUserId}
        query={searchQuery}
        search={searchHandler}
        setQuery={setSearchQuery}
      />
    </>
  );
}

/**
 * The phone shell's one focused flow — Search, Capture, Eve, or Menu — and the
 * focus restoration that makes closing one feel like coming back rather than
 * landing somewhere new: focus returns to the control that opened it, or to that
 * control's replacement when the surface behind it re-rendered in the meantime.
 *
 * It also reopens Search on a browser return. Global Recall stashes the owner and
 * the return URL in history state before navigating to a result, so coming back
 * lands in the search the owner left instead of a blank shell; the marker is
 * consumed on arrival so a later visit to the same URL does not reopen it.
 */
function useFocusedFlow(ownerUserId: string) {
  const [flow, setFlow] = useState<FocusedFlow | null>(null);
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

  return {
    flow,
    open(next: FocusedFlow, trigger: HTMLElement) {
      // Menu is the only flow that works unauthenticated; the rest are owner work.
      if (next !== "menu" && !ownerUserId) return;
      invokingControl.current = trigger;
      setFlow(next);
    },
    close() {
      const trigger = invokingControl.current;
      const triggerKey = trigger?.dataset.mobileFlowTrigger;
      setFlow(null);
      requestAnimationFrame(() => {
        const replacement = triggerKey
          ? document.querySelector<HTMLElement>(`[data-mobile-flow-trigger="${triggerKey}"]`)
          : null;
        (trigger?.isConnected ? trigger : replacement)?.focus();
      });
    },
    /** Closing because the owner is leaving: the destination owns focus, not us. */
    closeForNavigation() {
      setFlow(null);
    },
  };
}

function MobileRouteMain({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:py-8">
      {children}
    </main>
  );
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
  const homePanel = homePanelForLocation(pathname, searchParams);
  return (
    <MobileBottomBar
      hidden={hidden}
      mobileHome={pathname === "/" && homePanel === "today"}
      mobileReview={pathname === "/" && homePanel === "review"}
      onOpen={onOpen}
    />
  );
}

function MobileFocusedFlow({
  captureHandlers,
  flow,
  onClose,
  onNavigate,
  ownerUserId,
  query,
  search,
  setQuery,
}: {
  captureHandlers?: CaptureHandlers;
  flow: FocusedFlow | null;
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
    case "menu":
      return <MenuFlow onClose={onClose} />;
    default:
      return null;
  }
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
  const today = appDestination("today");
  const review = appDestination("review");
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
      <MobileNavLink active={mobileHome} href={today.route} icon={today.icon} label={today.label} />
      <MobileNavButton icon={SearchIcon} label="Search" onClick={onOpen} flow="search" />
      <MobileNavButton emphasized icon={PlusIcon} label="Capture" onClick={onOpen} flow="capture" />
      <MobileNavLink
        active={mobileReview}
        href={review.route}
        icon={review.icon}
        label={review.label}
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
