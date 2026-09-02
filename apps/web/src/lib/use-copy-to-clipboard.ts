"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Copies text and says so for a beat.
 *
 * `navigator.clipboard` is absent over plain HTTP and in older embedded
 * webviews, so this returns `null` there and the caller simply does not render
 * the control — a copy button that silently does nothing is worse than no copy
 * button. Every surface that offers "copy this" shares this one implementation
 * so the confirmation beat is the same length everywhere.
 */
export function useCopyToClipboard(): { copied: boolean; copy: (text: string) => void } | null {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return null;
  }

  return {
    copied,
    copy: (text: string) => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      });
    },
  };
}
