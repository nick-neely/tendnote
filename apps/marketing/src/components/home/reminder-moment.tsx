"use client";

import { cn } from "@tendnote/ui/cn";
import { TendnoteMark } from "@tendnote/ui/tendnote-logo";
import { useEffect, useRef, useState } from "react";

/*
 * The page's second authored moment: Friday's reminder arriving, once, when the
 * closing band scrolls into view. Decorative, so it is hidden from assistive
 * technology; the band's own copy says what it shows. Before hydration and with
 * reduced motion it is simply present.
 */
export function ReminderMoment({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setArrived(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setArrived(true);
          observer.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden
      className={cn(
        "w-full max-w-sm rounded-2xl border bg-background p-3.5 shadow-[0_12px_32px_-16px_rgb(0_0_0/0.35)] transition-[opacity,transform,filter] duration-700 ease-(--motion-ease-out) dark:shadow-[0_12px_32px_-16px_rgb(0_0_0/0.8)]",
        arrived ? "translate-y-0 opacity-100 blur-0" : "-translate-y-3 opacity-0 blur-[3px]",
        className,
      )}
      data-arrived={arrived}
      ref={ref}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[length:var(--text-caption)] font-medium">
          <TendnoteMark className="size-4" />
          Tendnote
        </span>
        <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
          Friday, 9:00 AM
        </span>
      </div>
      <p className="mt-2 text-sm font-medium">Ask Sam how the interview went</p>
      <p className="mt-0.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        Follow-up · Sam Rivera
      </p>
    </div>
  );
}
