// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTypedText } from "./use-typed-text";

const TEXT = "Coffee with Sam.";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useTypedText", () => {
  it("starts empty and types the text out once it becomes active", () => {
    // Home's hero turns typing on only after hydration; the text must still type then.
    const { rerender, result } = renderHook(({ active }) => useTypedText(TEXT, active, false), {
      initialProps: { active: false },
    });
    expect(result.current).toBe("");

    rerender({ active: true });
    act(() => vi.advanceTimersByTime(24 * 6));
    expect(result.current).toBe("Coffee");

    act(() => vi.advanceTimersByTime(24 * TEXT.length));
    expect(result.current).toBe(TEXT);
  });

  it("types again from the start each time it is reactivated", () => {
    const { rerender, result } = renderHook(({ active }) => useTypedText(TEXT, active, false), {
      initialProps: { active: true },
    });
    act(() => vi.advanceTimersByTime(24 * TEXT.length));
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current).toBe("");
  });

  it("shows the whole text at once with reduced motion", () => {
    const { result } = renderHook(() => useTypedText(TEXT, true, true));
    expect(result.current).toBe(TEXT);
  });
});
