import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
import { useDeepLinkHighlight } from "@/lib/use-deep-link-highlight";
import { renderInBrowser } from "@/test/browser";

import { ActionTodaySurface } from "./action-today-surface";
import { ActionsSurface } from "./actions-surface";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  window.location.hash = "";
  document.body.removeAttribute("style");
});

async function mount(ui: React.ReactNode): Promise<HTMLDivElement> {
  const rendered = await renderInBrowser(ui);
  cleanups.push(rendered.unmount);
  return rendered.container;
}

describe("Action mobile browser contracts", () => {
  it("reflows Actions at 390px without horizontal overflow", async () => {
    await page.viewport(390, 844);
    const container = await mount(
      <ActionsSurface
        active={[generalActionViewFixture()]}
        areas={[{ id: "home", name: "Home", archived: false }]}
        resolved={[]}
      />,
    );

    const filter = await page.getByRole("group", { name: "Filter by area" }).element();
    const reflowContainer = filter.parentElement;

    expect(getComputedStyle(reflowContainer as Element).flexDirection).toBe("column");
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  });

  it("keeps the Today glance inside a 390px viewport", async () => {
    await page.viewport(390, 844);
    const view = generalActionViewFixture({
      id: "action-due",
      title: "Replace the refrigerator water filter before the next delivery arrives",
      dueAtISO: "2026-07-20T12:00:00.000Z",
      dueAtDate: "2026-07-20",
      surfaceState: "today",
      surfaceLabel: "Due today",
    });
    const container = await mount(
      <ActionTodaySurface
        groups={[
          {
            reason: "due_today",
            heading: "Due today",
            items: [{ reason: "due_today", view }],
          },
        ]}
      />,
    );

    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    expect(
      (await page.getByRole("link", { name: view.title }).element()).getBoundingClientRect().right,
    ).toBeLessThanOrEqual(container.getBoundingClientRect().right);
  });

  it("gives lifecycle controls a 44px mobile hit area", async () => {
    await page.viewport(390, 844);
    await mount(
      <ActionsSurface
        active={[
          generalActionViewFixture({
            isRoutine: true,
            recurrence: { interval: 1, unit: "week" },
            recurrenceLabel: "Every week",
          }),
        ]}
        areas={[]}
        resolved={[]}
      />,
    );

    const moreActions = page.getByRole("button", { name: "More actions" });
    const primaryControls = [
      await page.getByRole("button", { name: "Done for now" }).element(),
      await moreActions.element(),
    ];

    for (const control of primaryControls) {
      const box = control.getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await act(async () => moreActions.click());

    for (const control of [
      await page.getByRole("menuitem", { name: "Set aside" }).element(),
      await page.getByRole("menuitem", { name: "Pause routine" }).element(),
      await page.getByRole("menuitem", { name: "Dismiss" }).element(),
      await page.getByRole("menuitem", { name: "Archive" }).element(),
    ]) {
      await expect.poll(() => control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(control.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    }

    await act(async () => {
      await userEvent.keyboard("{Escape}");
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    });
  });

  it("lands and pulses a deep link inside a real scroll container", async () => {
    await page.viewport(390, 844);
    window.location.hash = "#action-42";

    function ScrollHarness() {
      useDeepLinkHighlight();
      return (
        <div data-testid="scroll-container" style={{ height: 120, overflow: "auto" }}>
          <div style={{ height: 500 }} />
          <article id="action-42" style={{ height: 44 }} tabIndex={-1}>
            Deep-linked action
          </article>
          <div style={{ height: 500 }} />
        </div>
      );
    }

    const container = await mount(<ScrollHarness />);
    const scrollContainer = container.querySelector<HTMLElement>("[data-testid=scroll-container]");
    const target = await page.getByRole("article").element();

    await expect.poll(() => scrollContainer?.scrollTop ?? 0).toBeGreaterThan(0);
    expect(document.activeElement).toBe(target);
    expect(target.getAnimations().length).toBeGreaterThan(0);
  });
});
