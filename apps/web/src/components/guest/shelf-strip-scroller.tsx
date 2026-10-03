"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * Keeps the current shelf in view on a phone, where the shelves are one
 * horizontally scrolling strip and a new page would otherwise reset it to the
 * start, hiding the shelf just chosen. A no-op where nothing overflows.
 */
export function ShelfStripScroller({
  current,
  children,
}: {
  current: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const link = ref.current?.querySelector<HTMLElement>(`[data-shelf="${current}"]`);
    link?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);
  return <div ref={ref}>{children}</div>;
}
