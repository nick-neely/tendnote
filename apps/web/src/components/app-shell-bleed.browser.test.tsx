import { Activity, act, type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import { AppShell } from "./app-shell";
import { AssistantConversationRail } from "./assistant-conversation-rail";
import { SidebarProvider } from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";

/**
 * The bleed escape hatches, against the router's back/forward cache.
 *
 * Next does not unmount the segment you navigate away from: it keeps the last
 * few of them mounted inside a hidden `<Activity>` so returning restores their
 * state. React hides an Activity subtree by writing `display: none !important`
 * onto its roots rather than removing them, so the shell's one `<main>` really
 * does hold two destinations' markup at once — and `main:has(> [data-…-bleed])`
 * used to match the invisible one. Coming back from `/assistant`, the dashboard
 * lost its measure and its gutters until the page was reloaded.
 *
 * These drive the real `<Activity>` rather than a hand-written `display: none`,
 * so the rules in `globals.css` stay pinned to how React actually hides a
 * segment, not to the shape of the declaration it happens to write today.
 */

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

/** The shell, holding one visible destination and one in the router's bfcache. */
function mountTwoSegments(bleeding: ReactNode, plain: ReactNode) {
  let show: ((segment: "bleeding" | "plain") => void) | undefined;

  function Harness() {
    const [visible, setVisible] = useState<"bleeding" | "plain">("bleeding");
    show = setVisible;
    return (
      <AppShell ownerUserId="owner-1" searchHandler={vi.fn()}>
        <Activity mode={visible === "bleeding" ? "visible" : "hidden"}>{bleeding}</Activity>
        <Activity mode={visible === "plain" ? "visible" : "hidden"}>{plain}</Activity>
      </AppShell>
    );
  }

  return { Harness, navigateToPlain: async () => act(() => show?.("plain")) };
}

async function mainOf(ui: ReactNode) {
  const rendered = await renderInBrowser(ui);
  cleanups.push(rendered.unmount);
  const main = rendered.container.querySelector("main");
  if (!main) throw new Error("the shell rendered no <main>");
  return main;
}

describe("the shell's measure across a hidden segment", () => {
  it("gives the window to a full-bleed destination, and takes it back when that destination is only in the bfcache", async () => {
    await page.viewport(1440, 900);
    const { Harness, navigateToPlain } = mountTwoSegments(
      <div data-full-bleed>conversation canvas</div>,
      <div>a column of cards</div>,
    );
    const main = await mainOf(<Harness />);

    expect(getComputedStyle(main).maxWidth).toBe("none");
    expect(getComputedStyle(main).paddingLeft).toBe("0px");

    await navigateToPlain();

    expect(getComputedStyle(main).maxWidth).toBe("1280px");
    expect(getComputedStyle(main).paddingLeft).not.toBe("0px");
  });

  /**
   * The ledger toolbars (person, asset) bleed out of the reading measure to
   * reach the edges of the canvas. With the navigation rail beside them (#552)
   * "the edges of the canvas" is the rail's inset, not the window: a bar that
   * kept measuring against the window would slide under the rail.
   */
  it("bleeds a ledger toolbar to the edges of the rail's inset, and no further", async () => {
    await page.viewport(1440, 900);
    const rendered = await renderInBrowser(
      <AppShell ownerUserId="owner-1" searchHandler={vi.fn()}>
        <div className="mx-bleed px-gutter sm:-mx-6 sm:px-6" data-testid="ledger-toolbar">
          a sticky ledger toolbar
        </div>
      </AppShell>,
    );
    cleanups.push(rendered.unmount);

    const rail = document.querySelector('[data-slot="sidebar-container"]');
    const main = rendered.container.querySelector("main");
    const toolbar = rendered.container.querySelector('[data-testid="ledger-toolbar"]');
    if (!rail || !main || !toolbar) throw new Error("the shell rendered no rail, main, or toolbar");

    const railEdge = rail.getBoundingClientRect().right;
    const measure = main.getBoundingClientRect();
    const bled = toolbar.getBoundingClientRect();

    expect(railEdge).toBeCloseTo(256, 0);
    // Out of the measure's padding, and not one pixel past the rail.
    expect(bled.left).toBeLessThan(measure.left + 24);
    expect(bled.left).toBeGreaterThanOrEqual(railEdge);
  });

  /**
   * The canvas shell (ADR 0239): the navigation rail that cannot fold, beside
   * the rail the route brings with it. The conversation rail is `position:
   * fixed` against the window, so nothing about the flow moves it — it is told
   * where the navigation rail ends (`--tn-canvas-rail`), and if that ever stops
   * being true it slides underneath rather than beside, silently. The narrowest
   * desktop is where two rails and a transcript are tightest, so it is the width
   * worth pinning.
   */
  it("stands the conversation rail beside the canvas navigation rail, not under it", async () => {
    await page.viewport(1280, 900);
    const rendered = await renderInBrowser(
      <AppShell canvas ownerUserId="owner-1" searchHandler={vi.fn()}>
        {/* The root layout's, which the Assistant's rail rows expect. */}
        <TooltipProvider>
          <SidebarProvider data-full-bleed>
            <AssistantConversationRail
              archived={[]}
              conversations={[]}
              currentSessionId={null}
              now={new Date()}
              onArchive={vi.fn()}
              onNewConversation={vi.fn()}
              onRename={vi.fn()}
              onUnarchive={vi.fn()}
            />
            <div className="flex-1">a transcript</div>
          </SidebarProvider>
        </TooltipProvider>
      </AppShell>,
    );
    cleanups.push(rendered.unmount);

    const navigationRail = rendered.container.querySelector(
      'nav[aria-label="Primary"]',
    )?.parentElement;
    const conversationRail = rendered.container.querySelector('[data-slot="sidebar-container"]');
    if (!navigationRail || !conversationRail)
      throw new Error("the canvas rendered one rail, not two");

    const navigationEdge = navigationRail.getBoundingClientRect().right;
    expect(navigationEdge).toBeCloseTo(48, 0);
    expect(conversationRail.getBoundingClientRect().left).toBeCloseTo(navigationEdge, 0);
    // Both rails and the transcript, inside the window rather than past it.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
  });

  it("does the same for the phone canvas, whose rule is the same shape inside the narrow query", async () => {
    await page.viewport(390, 844);
    const { Harness, navigateToPlain } = mountTwoSegments(
      <div data-mobile-bleed>orientation band</div>,
      <div>a column of cards</div>,
    );
    const main = await mainOf(<Harness />);

    expect(getComputedStyle(main).maxWidth).toBe("none");
    expect(getComputedStyle(main).paddingLeft).toBe("0px");

    await navigateToPlain();

    expect(getComputedStyle(main).maxWidth).toBe("1280px");
    expect(getComputedStyle(main).paddingLeft).not.toBe("0px");
  });
});
