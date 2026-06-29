"use client";

import { useEffect, useState } from "react";
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

/**
 * Client tab shell for the person detail page. The page (a server component) does
 * the data work and renders each panel; this shell owns the active tab, the
 * sticky identity-plus-tabs region, and the URL-hash sync. The chat-free profile
 * stays a calm Personal Ledger — tabs just keep a person with a lot of history
 * (reviews, memories, follow-ups, drafts) from becoming one endless scroll.
 *
 * Counts are computed on the server and passed in; the section components call
 * `router.refresh()` on every mutation, so after an approve/dismiss the server
 * re-renders and the counts (and cross-tab data, like a newly saved memory
 * appearing under Memory) stay honest. The active tab is client state, preserved
 * across that refresh.
 */
export function PersonDetailTabs({
  initialTab,
  hasSnapshot,
  reviewCount,
  followupCount,
  draftsCount,
  header,
  snapshotPanel,
  reviewPanel,
  memoryPanel,
  followupsPanel,
  draftsPanel,
  aside,
}: {
  initialTab: PersonTab;
  hasSnapshot: boolean;
  reviewCount: number;
  followupCount: number;
  draftsCount: number;
  header: React.ReactNode;
  snapshotPanel: React.ReactNode;
  reviewPanel: React.ReactNode;
  memoryPanel: React.ReactNode;
  followupsPanel: React.ReactNode;
  draftsPanel: React.ReactNode;
  aside: React.ReactNode;
}) {
  const [active, setActive] = useState<PersonTab>(initialTab);

  useEffect(() => {
    function syncFromHash() {
      const id = window.location.hash.slice(1);
      const tab = HASH_TO_TAB[id];

      if (!tab || (tab === "snapshot" && !hasSnapshot)) {
        return;
      }

      setActive(tab);

      // Wait for the panel to mount, then bring the linked record under the
      // sticky header. Honor reduced-motion: jump instead of animating.
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(() => {
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }, 60);
    }

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);

    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [hasSnapshot]);

  return (
    <Tabs
      className="flex flex-col gap-6"
      onValueChange={(value) => setActive(value as PersonTab)}
      value={active}
    >
      {/* Sticky identity + tab nav: who you're looking at and where to go stay
          pinned while a long ledger scrolls beneath. Full-bleed to the content
          edges so the divider reads as a real toolbar. */}
      <div className="-mx-4 sticky top-14 z-10 flex flex-col gap-4 border-b bg-background/90 px-4 pt-1 pb-3 backdrop-blur sm:-mx-6 sm:px-6">
        {header}
        <TabsList className="w-fit max-w-full overflow-x-auto overflow-y-hidden">
          {hasSnapshot ? (
            <TabsTrigger className="group/tab" value="snapshot">
              Snapshot
            </TabsTrigger>
          ) : null}
          <TabsTrigger className="group/tab" value="review">
            Review
            <TabCount count={reviewCount} />
          </TabsTrigger>
          <TabsTrigger className="group/tab" value="memory">
            Memory
          </TabsTrigger>
          <TabsTrigger className="group/tab" value="followups">
            Follow-ups
            <TabCount count={followupCount} />
          </TabsTrigger>
          <TabsTrigger className="group/tab" value="drafts">
            Drafts
            <TabCount count={draftsCount} />
          </TabsTrigger>
        </TabsList>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
        <div className="min-w-0">
          {hasSnapshot ? (
            <TabsContent
              className="scroll-mt-40 outline-none"
              id="relationship-snapshot"
              value="snapshot"
            >
              {snapshotPanel}
            </TabsContent>
          ) : null}
          <TabsContent className="scroll-mt-40 outline-none" id="needs-review" value="review">
            {reviewPanel}
          </TabsContent>
          <TabsContent className="scroll-mt-40 outline-none" id="memories" value="memory">
            {memoryPanel}
          </TabsContent>
          <TabsContent className="scroll-mt-40 outline-none" id="follow-ups" value="followups">
            {followupsPanel}
          </TabsContent>
          <TabsContent className="scroll-mt-40 outline-none" id="message-drafts" value="drafts">
            {draftsPanel}
          </TabsContent>
        </div>

        <aside className="flex flex-col gap-6">{aside}</aside>
      </div>
    </Tabs>
  );
}
