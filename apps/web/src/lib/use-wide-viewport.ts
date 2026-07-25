"use client";

import { useEffect, useState } from "react";

/** The `lg` breakpoint, as a media query. Keep in step with Tailwind's `lg`. */
const WIDE_VIEWPORT = "(min-width: 64rem)";

/**
 * Whether the viewport is at or above `lg`, for the cases where a `lg:` class is
 * not enough: `hidden lg:contents` hides a subtree visually but React still
 * *mounts* it, so a component that does real work on mount does that work at
 * every width. Anything with a mount side effect — a lazily imported chunk, a
 * device-storage read, a one-shot handoff — has to gate on the breakpoint itself.
 *
 * Starts `false` so nothing mounts before the width is known, and the caller's
 * placeholder is what the server renders anyway.
 */
export function useWideViewport(): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(WIDE_VIEWPORT);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return wide;
}
