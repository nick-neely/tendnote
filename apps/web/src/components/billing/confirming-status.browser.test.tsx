import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import { AUTOMATIC_POLLING_WINDOW_MS, MANUAL_CHECK_COOLDOWN_MS } from "./admission-poller";
import { ConfirmingStatus } from "./confirming-status";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

let cleanup: (() => Promise<void>) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  refresh.mockReset();
});

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("the confirming status in a real browser (#765)", () => {
  it("keeps keyboard focus on an accessible manual check once automatic checks stop", async () => {
    ({ unmount: cleanup } = await renderInBrowser(
      <ConfirmingStatus email="subscriber@example.com" />,
    ));
    expect(page.getByRole("button").query()).toBeNull();

    await advance(AUTOMATIC_POLLING_WINDOW_MS);
    const automatic = refresh.mock.calls.length;
    expect(automatic).toBe(33);

    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Still waiting for confirmation");
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(
        "We've stopped checking automatically. You can close this page: we'll email subscriber@example.com as soon as you're in.",
      );

    const checkAgain = page.getByRole("button", { name: "Check again" });
    await expect.element(checkAgain).toBeVisible();
    await userEvent.tab();
    await expect.element(checkAgain).toHaveFocus();

    await act(async () => userEvent.keyboard("{Enter}"));
    expect(refresh).toHaveBeenCalledTimes(automatic + 1);

    const checking = page.getByRole("button", { name: "Checking" });
    await expect.element(checking).toHaveAttribute("aria-disabled", "true");
    await expect.element(checking).toHaveFocus();
    await act(async () => userEvent.keyboard("{Enter}"));
    expect(refresh).toHaveBeenCalledTimes(automatic + 1);

    await advance(MANUAL_CHECK_COOLDOWN_MS);
    await expect.element(checkAgain).toHaveFocus();
    await act(async () => userEvent.keyboard("{Enter}"));
    expect(refresh).toHaveBeenCalledTimes(automatic + 2);
  });
});
