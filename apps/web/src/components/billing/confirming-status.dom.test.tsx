// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/dom";
import { ConfirmingStatus, EMAIL_PROMISE_AFTER_MS } from "./confirming-status";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConfirmingStatus (#607)", () => {
  it("waits quietly, then after a minute promises the 'you're in' email", () => {
    render(<ConfirmingStatus email="subscriber@example.com" />);

    expect(screen.getByRole("status").textContent).toContain("Waiting for confirmation");
    expect(screen.queryByText(/we'll email/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(EMAIL_PROMISE_AFTER_MS - 1);
    });
    expect(screen.queryByText(/we'll email/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const status = screen.getByRole("status").textContent;
    expect(status).toContain("Still confirming");
    expect(status).toContain(
      "You can close this page: we'll email subscriber@example.com as soon as you're in.",
    );
  });
});
