// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/dom";
import {
  ADMISSION_POLL_STEPS,
  AUTOMATIC_POLLING_WINDOW_MS,
  admissionPollDelay,
  MANUAL_CHECK_COOLDOWN_MS,
} from "./admission-poller";
import { ConfirmingStatus } from "./confirming-status";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Every automatic check the schedule allows, in order, measured from mount. */
function scheduledCheckTimes(): number[] {
  const times: number[] = [];
  let at = 0;
  let delay: number | null = ADMISSION_POLL_STEPS[0].everyMs;
  while (delay !== null) {
    at = Math.min(at + delay, AUTOMATIC_POLLING_WINDOW_MS);
    times.push(at);
    delay = admissionPollDelay(at);
  }
  return times;
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const renderStatus = () => render(<ConfirmingStatus email="subscriber@example.com" />);

describe("the admission poll schedule (#765)", () => {
  it("checks every two seconds at first, then backs off, then stops at the window", () => {
    expect(admissionPollDelay(0)).toBe(2_000);
    expect(admissionPollDelay(29_999)).toBe(2_000);
    expect(admissionPollDelay(30_000)).toBe(5_000);
    expect(admissionPollDelay(60_000)).toBe(10_000);
    expect(admissionPollDelay(120_000)).toBe(30_000);
    expect(admissionPollDelay(AUTOMATIC_POLLING_WINDOW_MS - 1)).toBe(30_000);
    expect(admissionPollDelay(AUTOMATIC_POLLING_WINDOW_MS)).toBeNull();
  });

  it("allows a finite automatic budget of 33 checks in five minutes", () => {
    const times = scheduledCheckTimes();
    expect(times).toHaveLength(33);
    expect(times.at(-1)).toBe(AUTOMATIC_POLLING_WINDOW_MS);
  });
});

describe("automatic admission checks (#765)", () => {
  it("checks promptly at first so an ordinary payment lets the customer in within seconds", () => {
    renderStatus();
    expect(refresh).not.toHaveBeenCalled();

    advance(1_999);
    expect(refresh).not.toHaveBeenCalled();
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    advance(28_000);
    expect(refresh).toHaveBeenCalledTimes(15);
  });

  it("backs off after the first half minute", () => {
    renderStatus();
    advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(15);

    advance(4_999);
    expect(refresh).toHaveBeenCalledTimes(15);
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(16);
  });

  it("stops at the window and makes no further automatic request for the rest of the hour", () => {
    renderStatus();
    advance(AUTOMATIC_POLLING_WINDOW_MS);
    expect(refresh).toHaveBeenCalledTimes(33);

    advance(60 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(33);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("makes no request while hidden and no catch-up burst on return", () => {
    renderStatus();
    advance(10_000);
    expect(refresh).toHaveBeenCalledTimes(5);

    setVisibility("hidden");
    advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(5);

    setVisibility("visible");
    advance(0);
    expect(refresh).toHaveBeenCalledTimes(6);

    // The next check follows the backed-off schedule for the 70s spent waiting.
    advance(9_999);
    expect(refresh).toHaveBeenCalledTimes(6);
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(7);
  });

  it("does not check early when the page returns before a check is due", () => {
    renderStatus();
    advance(500);
    setVisibility("hidden");
    advance(500);
    setVisibility("visible");
    advance(0);
    expect(refresh).not.toHaveBeenCalled();

    advance(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not let rapid visibility changes multiply timers or reset the window", () => {
    renderStatus();
    for (let i = 0; i < 50; i += 1) {
      setVisibility("hidden");
      setVisibility("visible");
    }
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2);

    advance(AUTOMATIC_POLLING_WINDOW_MS + 60 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(33);
  });

  it("offers a manual check instead of checking when the page returns after the window", () => {
    renderStatus();
    advance(10_000);
    setVisibility("hidden");
    advance(AUTOMATIC_POLLING_WINDOW_MS);
    const before = refresh.mock.calls.length;

    setVisibility("visible");
    advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(before);
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("does not start polling while the page opens hidden", () => {
    visibility = "hidden";
    renderStatus();
    advance(10_000);
    expect(refresh).not.toHaveBeenCalled();

    setVisibility("visible");
    advance(0);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps checking after a refresh fails", () => {
    refresh.mockImplementationOnce(() => {
      throw new Error("offline");
    });
    renderStatus();

    expect(() => vi.advanceTimersByTime(2_000)).toThrow("offline");
    advance(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops every timer when the page leaves, as it does on admission's redirect", () => {
    const { unmount } = renderStatus();
    advance(4_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    advance(AUTOMATIC_POLLING_WINDOW_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("runs a single schedule under strict mode", () => {
    render(
      <StrictMode>
        <ConfirmingStatus email="subscriber@example.com" />
      </StrictMode>,
    );
    advance(AUTOMATIC_POLLING_WINDOW_MS + 60_000);
    expect(refresh).toHaveBeenCalledTimes(33);
  });
});

describe("the waiting state after automatic checks stop (#765)", () => {
  it("stays a calm waiting state with the email promise and an accessible manual check", () => {
    renderStatus();
    expect(screen.queryByRole("button")).toBeNull();

    advance(AUTOMATIC_POLLING_WINDOW_MS);
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("Still waiting for confirmation");
    expect(status).toContain("stopped checking automatically");
    expect(status).toContain("we'll email subscriber@example.com as soon as you're in.");
    expect(status).not.toMatch(/fail|refund|not charged|declined/i);
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("checks once per press and ignores rapid repeats until the check settles", () => {
    renderStatus();
    advance(AUTOMATIC_POLLING_WINDOW_MS);
    refresh.mockClear();

    const button = screen.getByRole("button", { name: "Check again" });
    act(() => {
      button.click();
      button.click();
      button.click();
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    const checking = screen.getByRole("button", { name: "Checking" });
    expect(checking.getAttribute("aria-disabled")).toBe("true");
    expect(checking).toBe(button);

    advance(MANUAL_CHECK_COOLDOWN_MS);
    expect(screen.getByRole("button", { name: "Check again" }).getAttribute("aria-disabled")).toBe(
      "false",
    );
    act(() => button.click());
    expect(refresh).toHaveBeenCalledTimes(2);

    // A manual check does not restart automatic polling.
    advance(60 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("recovers the manual check after a failed refresh", () => {
    renderStatus();
    advance(AUTOMATIC_POLLING_WINDOW_MS);
    refresh.mockReset();
    refresh.mockImplementationOnce(() => {
      throw new Error("offline");
    });

    // jsdom reports an error thrown by a click handler to the window instead of rethrowing it.
    const reported: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      reported.push(event.error);
    };
    window.addEventListener("error", onError);
    const button = screen.getByRole("button", { name: "Check again" });
    act(() => button.click());
    window.removeEventListener("error", onError);
    expect(reported).toEqual([new Error("offline")]);

    advance(MANUAL_CHECK_COOLDOWN_MS);
    act(() => button.click());
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
