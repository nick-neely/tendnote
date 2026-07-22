// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/dom";
import { MobileFailureState } from "./mobile-failure-state";

describe("mobile failure recovery", () => {
  it.each([
    ["offline", "You're offline", "Try again"],
    ["authentication", "Your session expired", "Sign in"],
    ["app_server", "Tendnote couldn't load", "Try again"],
    ["capture_change", "Change wasn't saved", "Try change again"],
    ["capture_save", "Capture wasn't saved", "Try saving again"],
    ["capture_undo", "Undo wasn't confirmed", "Try Undo again"],
    ["eve", "Eve is unavailable", "Try Eve again"],
    ["cache_mismatch", "Tendnote needs a refresh", "Refresh"],
  ] as const)("distinguishes %s with its safe next action", (kind, heading, action) => {
    render(<MobileFailureState kind={kind} onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByRole("heading", { name: heading })).toBeDefined();
    expect(
      screen.getByRole(kind === "authentication" ? "link" : "button", { name: action }),
    ).toBeDefined();
  });
});
