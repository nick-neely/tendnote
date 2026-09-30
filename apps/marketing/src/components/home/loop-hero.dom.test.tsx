// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoopHero } from "./loop-hero";
import { beats, NOTE_TEXT, QUESTION_TEXT } from "./loop-script";

/*
 * jsdom has no layout, so these tests run the hero the way a reduced-motion
 * visitor gets it: nothing pins, and the step buttons switch the stage
 * directly. The scroll-driven path is verified in a browser.
 */
function mockMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("reduce") ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => mockMatchMedia(true));
afterEach(() => cleanup());

function stage(): HTMLElement {
  const node = document.querySelector("[inert]");
  if (!(node instanceof HTMLElement)) throw new Error("stage not rendered");
  return node;
}

function steps(): HTMLElement[] {
  // The desktop list and the phone dots both render; either drives the same stage.
  const [list] = screen.getAllByRole("list", { name: "Steps in Sam's week" });
  if (!list) throw new Error("step list not rendered");
  return within(list).getAllByRole("button");
}

describe("LoopHero", () => {
  it("leads with the headline and the two decided calls to action", () => {
    render(<LoopHero />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Be the friend who remembers.",
    );
    expect(screen.getByRole("link", { name: "Explore the demo" }).getAttribute("href")).toBe(
      "/demo",
    );
    expect(screen.getByRole("link", { name: "View pricing" }).getAttribute("href")).toBe(
      "/pricing",
    );
  });

  it("keeps the illustration out of the accessibility tree and the tab order", () => {
    render(<LoopHero />);
    const node = stage();
    expect(node.getAttribute("aria-hidden")).toBe("true");
    expect(node.hasAttribute("inert")).toBe(true);
    expect(within(node).getByText(NOTE_TEXT)).toBeTruthy();
  });

  it("offers every beat as a step and marks the live one", () => {
    render(<LoopHero />);
    const buttons = steps();
    expect(buttons.map((button) => button.textContent)).toEqual(
      beats.map((beat) => beat.title + beat.body),
    );
    expect(buttons[0]?.getAttribute("aria-current")).toBe("step");
    expect(buttons[1]?.getAttribute("aria-current")).toBeNull();
  });

  it("walks the stage through the loop when the steps are pressed", async () => {
    const user = userEvent.setup();
    render(<LoopHero />);
    const [, memory, followUp, today, ask] = steps();
    if (!memory || !followUp || !today || !ask) throw new Error("missing steps");

    await user.click(memory);
    expect(memory.getAttribute("aria-current")).toBe("step");
    expect(within(stage()).getByText("Saved to memory")).toBeTruthy();
    expect(within(stage()).getByText("What did they tell you?")).toBeTruthy();

    await user.click(followUp);
    expect(within(stage()).getByText("Follow-up · Friday")).toBeTruthy();
    // The Follow-up card and Friday's Today panel both carry the reason.
    expect(within(stage()).getAllByText("Ask Sam how the interview went")).toHaveLength(2);

    await user.click(today);
    expect(within(stage()).getAllByText("Today").length).toBeGreaterThan(0);
    expect(within(stage()).queryByText(QUESTION_TEXT)).toBeNull();

    await user.click(ask);
    expect(within(stage()).getByText(QUESTION_TEXT)).toBeTruthy();
    expect(within(stage()).getByText(/From your note/)).toBeTruthy();
    expect(ask.getAttribute("aria-current")).toBe("step");
  });

  it("does not grow the section or pin when motion is reduced", () => {
    render(<LoopHero />);
    const section = screen.getByRole("region", { name: "Be the friend who remembers." });
    expect(section.className).not.toContain("svh");
    expect(stage().parentElement?.className).not.toContain("sticky");
  });
});
