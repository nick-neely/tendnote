import { Activity, act, type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import { AppShell } from "./app-shell";

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
