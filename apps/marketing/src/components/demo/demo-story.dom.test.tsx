// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoStory } from "./demo-story";

/*
 * The Marketing Demo makes no inference, account, product write, or reminder:
 * it never touches the network. These tests play the story with `fetch`
 * replaced by a spy that fails the test if anything calls it.
 */
function mockMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("reduce") ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not use the network")));

beforeEach(() => {
  mockMatchMedia(false);
  vi.stubGlobal("fetch", fetchSpy);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchSpy.mockClear();
});

function steps(): HTMLElement[] {
  // The desktop list and the phone bars both render; either drives the same story.
  const [list] = screen.getAllByRole("list", { name: "Steps in the demo" });
  if (!list) throw new Error("step list not rendered");
  return within(list).getAllByRole("button");
}

function announced(): string {
  return document.querySelector("[aria-live]")?.textContent ?? "";
}

async function playToTheAnswer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Send" }));
  await user.click(screen.getByRole("button", { name: "Approve suggestion for Sam Rivera" }));
  await user.click(screen.getByRole("radio", { name: "Saturday" }));
  await user.click(
    screen.getByRole("button", { name: "Accept suggested follow-up for Sam Rivera" }),
  );
  await user.click(screen.getByRole("button", { name: "What was Sam nervous about?" }));
}

describe("DemoStory", () => {
  it("opens on Sam's interview and offers View pricing from the start", () => {
    render(<DemoStory />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Sam has a big interview on Thursday.",
    );
    for (const link of screen.getAllByRole("link", { name: "View pricing" })) {
      expect(link.getAttribute("href")).toBe("/pricing");
    }
  });

  it("plays the whole story with the answer citing its source, and never fetches", async () => {
    const user = userEvent.setup();
    render(<DemoStory />);

    await playToTheAnswer(user);
    expect(screen.getByText("Saved to memory")).toBeTruthy();
    expect(screen.getByText("Reminder set")).toBeTruthy();
    expect(screen.getByText("Saturday morning")).toBeTruthy();
    // The stage bar and the day divider both move the thread to Wednesday.
    expect(screen.getAllByText("Wednesday")).toHaveLength(2);
    expect(screen.getByText("Confirmed fact · the source of Eve's answer below")).toBeTruthy();
    expect(screen.getByText(/^The portfolio review\./)).toBeTruthy();
    expect(screen.getByText("From your note · Tuesday, after coffee")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Skip ahead to Saturday" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Ask Sam how the interview went.",
    );
    expect(screen.getByText(/Three days later, at 9:00 AM on Saturday/)).toBeTruthy();
    expect(announced()).toMatch(/^Three days later\. Saturday, 9:00 AM\./);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("types the note in, or shows it whole with reduced motion", async () => {
    mockMatchMedia(true);
    render(<DemoStory />);
    expect(await screen.findByText(/^Coffee with Sam\. Final-round interview/)).toBeTruthy();
  });

  it("moves focus to the next thing to do after each action", async () => {
    const user = userEvent.setup();
    render(<DemoStory />);

    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Approve suggestion for Sam Rivera" }),
    );
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Friday/ }));
  });

  it("revisits any step from the list and restarts the story", async () => {
    const user = userEvent.setup();
    render(<DemoStory />);
    await playToTheAnswer(user);

    const [, memory] = steps();
    if (!memory) throw new Error("missing step");
    await user.click(memory);
    expect(memory.getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: "Approve suggestion for Sam Rivera" })).toBeTruthy();
    expect(screen.queryByText(/^The portfolio review\./)).toBeNull();
    expect(announced()).toBe("Step 2 of 5: Keep what is worth keeping.");

    const [restart] = screen.getAllByRole("button", { name: "Restart the story" });
    if (!restart) throw new Error("missing restart");
    await user.click(restart);
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByText("Saved to memory")).toBeNull();
  });

  it("reaches the reminder from the list without playing the steps", async () => {
    const user = userEvent.setup();
    render(<DemoStory />);
    const last = steps().at(-1);
    if (!last) throw new Error("missing step");
    await user.click(last);
    expect(screen.getByText(/Two days later, at 9:00 AM on Friday/)).toBeTruthy();
  });

  it("skips the day roll with reduced motion and shows the reminder at once", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    render(<DemoStory />);
    await playToTheAnswer(user);
    await user.click(screen.getByRole("button", { name: "Skip ahead to Saturday" }));
    expect(document.querySelector(".tn-roll")).toBeNull();
    expect(document.querySelector("[style*='animation-delay']")).toBeNull();
  });
});
