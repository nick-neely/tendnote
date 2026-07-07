"use client";

import { useEffect } from "react";

/**
 * Scrolls to, focuses, and briefly highlights the element named by the current URL
 * hash — the landing half of a deep link (e.g. the Action Today surface links to
 * `/actions#action-<id>`, and this carries the arriving user to that exact row). Runs on
 * mount and on `hashchange`, so both a fresh navigation and an in-page hash change land.
 *
 * The pulse uses the Web Animations API against a CSS custom property rather than a
 * Tailwind class, so no class needs to exist in the build for it to render; a
 * reduced-motion preference skips the pulse and just scrolls/focuses. Focus moves to the
 * target (which opts in with `tabIndex={-1}`) so screen readers announce the jump.
 */
export function useDeepLinkHighlight(): void {
  useEffect(() => {
    function highlightFromHash() {
      const id = window.location.hash.slice(1);
      if (!id) {
        return;
      }
      const target = document.getElementById(id);
      if (!target) {
        return;
      }

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      target.focus({ preventScroll: true });

      if (!reduceMotion && typeof target.animate === "function") {
        target.animate(
          [
            { backgroundColor: "var(--accent-soft)" },
            { backgroundColor: "var(--accent-soft)", offset: 0.6 },
            { backgroundColor: "transparent" },
          ],
          { duration: 1600, easing: "ease-out" },
        );
      }
    }

    // A fresh navigation lands with the hash already set; wait a frame so the target
    // has mounted before scrolling.
    const raf = requestAnimationFrame(highlightFromHash);
    window.addEventListener("hashchange", highlightFromHash);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", highlightFromHash);
    };
  }, []);
}
