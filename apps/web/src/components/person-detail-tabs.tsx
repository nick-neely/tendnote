"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { TabCount } from "@/components/tab-count";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type PersonTab = "snapshot" | "review" | "memory" | "followups" | "drafts";

// Existing deep links point at record anchors (the dashboard rail, the snapshot
// card corrections, the draft entry points). With the ledger split across tabs,
// a hash must select the tab that holds that anchor — otherwise those links land
// on the wrong tab. The anchor ids still live on the sections inside each panel,
// so once the tab is active we scroll the exact record into view.
const HASH_TO_TAB: Record<string, PersonTab> = {
  "relationship-snapshot": "snapshot",
  "needs-review": "review",
  memories: "memory",
  "logged-context": "memory",
  "follow-ups": "followups",
  "message-drafts": "drafts",
};

function tabForPersonHash(id: string): PersonTab | undefined {
  if (id.startsWith("followup-")) return "followups";
  if (id.startsWith("memory-")) return "memory";
  return HASH_TO_TAB[id];
}

function scrollToPersonHashTarget(id: string) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.setTimeout(() => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, 60);
}

/**
 * Everything about *which* tab is open: the server's choice, the URL hash, the
 * horizontal scroll of the rail, and the round trip a deep link needs.
 *
 * Split out of the shell because the two are different jobs. The shell is layout
 * and can be read top to bottom; this is a small state machine with three
 * effects that have to agree with each other, and reading it beside the JSX made
 * both harder to follow.
 */
function usePersonTabSelection({
  initialTab,
  hasSnapshot,
}: {
  initialTab: PersonTab;
  hasSnapshot: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState<PersonTab>(initialTab);
  const tabsListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActive(initialTab);
  }, [initialTab]);

  useEffect(() => {
    // The rail scrolls sideways on a phone, so a tab chosen by URL rather than
    // by tapping can land off-screen. `nearest` leaves an already-visible tab
    // alone and never moves the page vertically.
    tabsListRef.current
      ?.querySelector(`[data-tab="${active}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  // Only the selected pane is rendered on the server, so choosing a tab has to
  // reach the server as well as the tab state - otherwise the pane opens empty.
  const selectTab = useCallback(
    (tab: PersonTab, hash: string) => {
      const params = new URLSearchParams(window.location.search);
      params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}${hash}`, { scroll: false });
    },
    [pathname, router],
  );

  useEffect(() => {
    function syncFromHash() {
      const id = window.location.hash.slice(1);
      const tab = tabForPersonHash(id);

      if (!tab || (tab === "snapshot" && !hasSnapshot)) {
        return;
      }

      setActive(tab);

      // A deep link carries the record, not the pane, so the server may have
      // rendered a different tab. Ask it for this one, keeping the hash so the
      // link stays shareable - this effect then runs again once the pane
      // arrives, and scrolls to a record that now exists.
      if (tab !== initialTab) {
        selectTab(tab, window.location.hash);
      }

      // Wait for the panel to mount, then bring the linked record under the sticky header.
      scrollToPersonHashTarget(id);
    }

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);

    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [hasSnapshot, initialTab, selectTab]);

  /** Picking a tab by hand drops any record hash: the link is now about the pane. */
  const chooseTab = useCallback(
    (tab: PersonTab) => {
      setActive(tab);
      selectTab(tab, "");
    },
    [selectTab],
  );

  return { active, chooseTab, tabsListRef };
}

/**
 * Client tab shell for the person detail page. The page (a server component) does
 * the data work and renders each panel; this shell owns the active tab, the
 * sticky identity-plus-tabs region, and the URL-hash sync. The chat-free profile
 * stays a calm Personal Ledger — tabs just keep a person with a lot of history
 * (reviews, memories, follow-ups, drafts) from becoming one endless scroll.
 *
 * The tab badges are the page's only count vocabulary - the header carries no
 * stat line. Counts are computed on the server from the cached person core, so
 * they are all present whichever pane is open, and the section components call
 * `router.refresh()` on every mutation, so after an approve/dismiss the server
 * re-renders and the counts (and cross-tab data, like a newly saved memory
 * appearing under Memory) stay honest. The active tab is client state, preserved
 * across that refresh.
 */
export function PersonDetailTabs({
  initialTab,
  hasSnapshot,
  reviewCount,
  memoryCount,
  followupCount,
  draftsCount,
  header,
  snapshotPanel,
  reviewPanel,
  memoryPanel,
  followupsPanel,
  draftsPanel,
  capture,
  aside,
}: {
  initialTab: PersonTab;
  hasSnapshot: boolean;
  reviewCount: number;
  /** Confirmed memories - what the Memories section lists, not suggestions. */
  memoryCount: number;
  followupCount: number;
  draftsCount: number;
  header: React.ReactNode;
  snapshotPanel: React.ReactNode;
  reviewPanel: React.ReactNode;
  memoryPanel: React.ReactNode;
  followupsPanel: React.ReactNode;
  draftsPanel: React.ReactNode;
  /** Note capture: first in reach on mobile, top of the rail on desktop. */
  capture: React.ReactNode;
  aside: React.ReactNode;
}) {
  const { active, chooseTab, tabsListRef } = usePersonTabSelection({ hasSnapshot, initialTab });

  return (
    <Tabs
      className="flex flex-col gap-6"
      onValueChange={(value) => chooseTab(value as PersonTab)}
      value={active}
    >
      {/* Sticky identity + tab nav: who you're looking at and where to go stay
          pinned while a long ledger scrolls beneath. Full-bleed to the content
          edges so the divider reads as a real toolbar. */}
      {/* `top-0` on mobile, `lg:top-14` on desktop: the desktop top bar is what
          the 56px offset clears, and mobile has no top bar - a flat `top-14`
          left the header floating below a dead band on a phone. */}
      <div className="mx-bleed sticky top-0 z-10 flex flex-col gap-4 border-b bg-background/90 px-gutter pt-1 pb-3 backdrop-blur sm:-mx-6 sm:px-6 lg:top-14">
        {header}
        {/* `justify-start` matters on narrow screens: five labelled tabs with
            counts overflow a phone, and a centered flex row spills off both
            edges with no way to scroll back to the first tab. */}
        <TabsList
          className="w-fit max-w-full justify-start overflow-x-auto overflow-y-hidden"
          ref={tabsListRef}
        >
          {hasSnapshot ? (
            <TabsTrigger className="group/tab" data-tab="snapshot" value="snapshot">
              Snapshot
            </TabsTrigger>
          ) : null}
          <TabsTrigger className="group/tab" data-tab="review" value="review">
            Review
            <TabCount count={reviewCount} />
          </TabsTrigger>
          <TabsTrigger className="group/tab" data-tab="memory" value="memory">
            Memory
            <TabCount count={memoryCount} />
          </TabsTrigger>
          <TabsTrigger className="group/tab" data-tab="followups" value="followups">
            Follow-ups
            <TabCount count={followupCount} />
          </TabsTrigger>
          <TabsTrigger className="group/tab" data-tab="drafts" value="drafts">
            Drafts
            <TabCount count={draftsCount} />
          </TabsTrigger>
        </TabsList>
      </div>

      {/* One capture, placed twice by the grid rather than rendered twice: on
          mobile it is the first thing under the tabs, keeping Tendnote
          capture-first in one thumb's reach; on desktop it heads the right rail
          beside the ledger, where it never pushes content down. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] lg:gap-8">
        <div className="lg:col-start-2 lg:row-start-1">{capture}</div>
        {/* A pane carries a deep-link anchor only when nothing inside it already
            does: the snapshot card owns `relationship-snapshot`, and the ledger
            sections own `memories` and `logged-context`. Claiming them here too
            put the same id in the document twice. */}
        <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {hasSnapshot ? (
            <TabsContent className="scroll-mt-40 outline-none" value="snapshot">
              {snapshotPanel}
            </TabsContent>
          ) : null}
          <TabsContent className="scroll-mt-40 outline-none" id="needs-review" value="review">
            {reviewPanel}
          </TabsContent>
          <TabsContent className="scroll-mt-40 outline-none" value="memory">
            {memoryPanel}
          </TabsContent>
          <TabsContent className="scroll-mt-40 outline-none" id="follow-ups" value="followups">
            {followupsPanel}
          </TabsContent>
          <TabsContent className="scroll-mt-40 outline-none" id="message-drafts" value="drafts">
            {draftsPanel}
          </TabsContent>
        </div>

        <aside className="flex flex-col gap-6 lg:col-start-2 lg:row-start-2">{aside}</aside>
      </div>
    </Tabs>
  );
}
