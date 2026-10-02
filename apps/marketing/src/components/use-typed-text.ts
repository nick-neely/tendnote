"use client";

import { useEffect, useState } from "react";

const TYPE_INTERVAL_MS = 24;

/**
 * Types `text` out a character at a time each time `active` turns on, as if
 * someone were writing it. Starts empty, so the server render and hydration
 * show an empty box rather than the whole text that then vanishes. With
 * reduced motion the text appears whole.
 */
export function useTypedText(text: string, active: boolean, reduced: boolean): string {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (reduced) {
      setCount(text.length);
      return;
    }
    setCount(0);
    const timer = window.setInterval(() => {
      setCount((value) => {
        if (value >= text.length) {
          window.clearInterval(timer);
          return value;
        }
        return value + 1;
      });
    }, TYPE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, reduced, text]);

  return text.slice(0, count);
}
