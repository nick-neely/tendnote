"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AssetTab = "snapshot" | "memory" | "actions" | "connections" | "history" | "review";

// The hash names the record or the pane, never the tab index, so a link stays
// readable and survives a re-ordering of the tabs. Record anchors resolve to the
// pane that holds them: Global Recall deep-links straight at an Asset Memory
// (`/assets/<id>#asset-memory-<id>`), which lives under Memory.
const HASH_TO_TAB: Record<string, AssetTab> = {
  actions: "actions",
  connections: "connections",
  evidence: "memory",
  history: "history",
  memories: "memory",
  memory: "memory",
  people: "connections",
  "related-actions": "actions",
  "related-assets": "connections",
  review: "review",
  snapshot: "snapshot",
  summary: "snapshot",
};

function tabForAssetHash(id: string): AssetTab | undefined {
  if (id.startsWith("asset-memory-")) return "memory";
  if (id.startsWith("asset-evidence-")) return "memory";
  return HASH_TO_TAB[id];
}

function scrollToAssetHashTarget(id: string) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.setTimeout(() => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, 60);
}

// Every pane stays mounted (`forceMount`) so the server's per-section Suspense
// boundaries keep streaming into tabs nobody has opened yet, and so a pane keeps
// its scroll position and any in-flight optimistic state across a tab switch.
// Only the active one is laid out.
const PANEL =
  "scroll-mt-32 flex-col gap-8 outline-none data-[state=active]:flex data-[state=inactive]:hidden";

/**
 * Client tab shell for the Asset Profile. The page (a server component) does all
 * the data work and hands each pane in as a prop, already wrapped in its own
 * Suspense boundary; this shell owns the active tab, the sticky tab bar, and the
 * URL-hash sync.
 *
 * The asset profile had grown into one ~2400px scroll of eight stacked sections.
 * Tabs are the same answer the person ledger already reached for: identity stays
 * pinned at the top, and the ledger underneath is grouped by the question being
 * asked - what is this (Snapshot), what do I know about it (Memory), what is
 * scheduled for it (Actions), what is it tied to (Connections), what happened to
 * it (History). Review joins them only while something is actually pending.
 *
 * The tab badges are the page's only count vocabulary - the header carries no
 * stat line, so "Actions 0 / People 0" cannot become noise: a zero-count tab is
 * just its label. Counts stream in from the server as their read resolves, so
 * the bar is usable before the numbers land.
 */
export function AssetDetailTabs({
  memoryBadge,
  actionsBadge,
  connectionsBadge,
  reviewTrigger,
  snapshotPanel,
  memoryPanel,
  actionsPanel,
  connectionsPanel,
  historyPanel,
  reviewPanel,
}: {
  /** Streamed `TabCount` nodes; each arrives with its own read, or never. */
  memoryBadge: React.ReactNode;
  actionsBadge: React.ReactNode;
  connectionsBadge: React.ReactNode;
  /**
   * The whole Review trigger, streamed: it resolves to nothing unless this asset
   * has pending review items, so the tab exists only while it means something.
   */
  reviewTrigger: React.ReactNode;
  snapshotPanel: React.ReactNode;
  memoryPanel: React.ReactNode;
  actionsPanel: React.ReactNode;
  connectionsPanel: React.ReactNode;
  historyPanel: React.ReactNode;
  reviewPanel: React.ReactNode;
}) {
  const [active, setActive] = useState<AssetTab>("snapshot");

  // Picking a tab rewrites the hash in place rather than pushing a route: every
  // pane is already mounted, so there is nothing to fetch, and a Back button
  // full of tab switches would bury the page the reader actually came from.
  const selectTab = useCallback((tab: AssetTab) => {
    setActive(tab);
    window.history.replaceState(window.history.state, "", `#${tab}`);
  }, []);

  useEffect(() => {
    function syncFromHash() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const tab = id ? tabForAssetHash(id) : undefined;

      if (!tab) {
        return;
      }

      setActive(tab);
      // Wait for the pane to be laid out, then bring the linked record (or the
      // pane itself) out from under the sticky bar.
      scrollToAssetHashTarget(id);
    }

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);

    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  return (
    <Tabs
      className="flex flex-col gap-6"
      onValueChange={(value) => selectTab(value as AssetTab)}
      value={active}
    >
      {/* Where to go stays pinned while a long ledger scrolls beneath. Full-bleed
          on narrow screens, then exactly the reading column once the column is
          narrower than the viewport, so the rule reads as this page's toolbar. */}
      <div className="-mx-4 sticky top-0 z-10 border-b bg-background/90 px-4 pt-1 pb-3 backdrop-blur sm:-mx-6 sm:px-6 lg:top-14 lg:mx-0 lg:px-0">
        {/* `justify-start` matters once the strip overflows: the shared TabsList
            centers its children, and centered content inside a scroll container
            spills off *both* edges with scrollLeft pinned at 0 - which on a phone
            left the first tab clipped and unreachable. */}
        <TabsList className="w-fit max-w-full justify-start overflow-x-auto overflow-y-hidden">
          <TabsTrigger className="group/tab" data-tab="snapshot" value="snapshot">
            Snapshot
          </TabsTrigger>
          <TabsTrigger className="group/tab" data-tab="memory" value="memory">
            Memory
            {memoryBadge}
          </TabsTrigger>
          <TabsTrigger className="group/tab" data-tab="actions" value="actions">
            Actions
            {actionsBadge}
          </TabsTrigger>
          <TabsTrigger className="group/tab" data-tab="connections" value="connections">
            Connections
            {connectionsBadge}
          </TabsTrigger>
          <TabsTrigger className="group/tab" data-tab="history" value="history">
            History
          </TabsTrigger>
          {reviewTrigger}
        </TabsList>
      </div>

      <div className="min-w-0">
        <TabsContent className={PANEL} forceMount id="snapshot" value="snapshot">
          {snapshotPanel}
        </TabsContent>
        <TabsContent className={PANEL} forceMount id="memory" value="memory">
          {memoryPanel}
        </TabsContent>
        <TabsContent className={PANEL} forceMount id="actions" value="actions">
          {actionsPanel}
        </TabsContent>
        <TabsContent className={PANEL} forceMount id="connections" value="connections">
          {connectionsPanel}
        </TabsContent>
        <TabsContent className={PANEL} forceMount id="history" value="history">
          {historyPanel}
        </TabsContent>
        <TabsContent className={PANEL} forceMount id="review" value="review">
          {reviewPanel}
        </TabsContent>
      </div>
    </Tabs>
  );
}
