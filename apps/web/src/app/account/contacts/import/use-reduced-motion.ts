"use client";

import { useEffect, useState } from "react";

/** Whether the owner has asked the OS to reduce motion, tracked live. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(media.matches);
    const onChange = (event: MediaQueryListEvent) => setReduce(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduce;
}
