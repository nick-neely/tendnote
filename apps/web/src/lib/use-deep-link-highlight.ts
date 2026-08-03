"use client";

import { useEffect, useRef } from "react";

/**
 * How long the landing half waits for a claimed target to render before giving up.
 * A revealed section has to open *and* finish its fetch, so this is generous; it exists
 * only so a claim that never resolves stops observing rather than leaking.
 */
const REVEAL_TIMEOUT_MS = 8_000;

/**
 * Claims a deep-link target the claiming surface can show but has not rendered yet.
 *
 * Return `true` to say "that row is mine, I am revealing it" - the hook then waits for the
 * element to appear and lands on it. Return `false` for anything the surface does not own,
 * so an unknown hash stays a quiet no-op.
 */
type DeepLinkRevealer = (elementId: string) => boolean;

const revealers = new Set<DeepLinkRevealer>();

/**
 * Registers a surface's {@link DeepLinkRevealer} for the lifetime of the component.
 *
 * The seam exists because the landing half cannot see the whole page: a surface may hold
 * the deep-linked row behind a folded section whose rows are fetched on open (the Actions
 * secondary shelf), so the element genuinely is not in the DOM when the hash arrives. The
 * hook stays generic - it knows only "someone claimed this id, watch for it" - and each
 * surface keeps its own knowledge of which fold and which fetch reach that row.
 */
export function useDeepLinkReveal(reveal: DeepLinkRevealer): void {
  const latest = useRef(reveal);
  useEffect(() => {
    latest.current = reveal;
  });
  useEffect(() => {
    // Registered through a stable indirection so a re-render's fresh closure (which reads
    // current state) is used without churning the registry on every render.
    const revealer: DeepLinkRevealer = (elementId) => latest.current(elementId);
    revealers.add(revealer);
    return () => {
      revealers.delete(revealer);
    };
  }, []);
}

/**
 * Scrolls to, focuses, and briefly highlights the element named by the current URL
 * hash — the landing half of a deep link (e.g. the Action Today surface links to
 * `/actions#action-<id>`, and this carries the arriving user to that exact row). Runs on
 * mount, `hashchange`, and same-document `popstate` navigation, so route transitions land
 * after the destination has mounted as well as in-page hash changes.
 *
 * When the hash names nothing on the page it asks the registered surfaces
 * ({@link useDeepLinkReveal}) whether one of them can reveal it. A resolved Action lives in
 * a folded shelf that fetches on open, so its row is absent until the surface opens the
 * shelf and the rows arrive; if a surface claims the id, this waits for the element and
 * then lands on it. An unclaimed hash - a stale or wrong link - does nothing at all: no
 * scroll, no error, no flash.
 *
 * The pulse uses the Web Animations API against a CSS custom property rather than a
 * Tailwind class, so no class needs to exist in the build for it to render; a
 * reduced-motion preference skips the pulse and just scrolls/focuses. Focus moves to the
 * target (which opts in with `tabIndex={-1}`) so screen readers announce the jump.
 */
export function useDeepLinkHighlight(): void {
  useEffect(() => {
    let stopWaiting: (() => void) | null = null;
    let scheduledFrame: number | null = null;

    function landOn(target: HTMLElement) {
      // A target inside a collapsed native disclosure must be revealed before it can be
      // scrolled to. Radix `Collapsible` sections unmount their contents instead, so those
      // go through the reveal contract above rather than this walk.
      for (
        let details = target.closest("details");
        details;
        details = details.parentElement?.closest("details") ?? null
      ) {
        details.open = true;
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

    function highlightFromHash() {
      stopWaiting?.();
      stopWaiting = null;

      const id = window.location.hash.slice(1);
      if (!id) {
        return;
      }
      const target = document.getElementById(id);
      if (target) {
        landOn(target);
        return;
      }

      // Nothing under that id yet. Every claim runs - a surface reveals by opening a fold
      // and starting a fetch, and more than one may hold rows - but one claim is enough to
      // start watching for the row.
      let claimed = false;
      for (const reveal of revealers) {
        if (reveal(id)) {
          claimed = true;
        }
      }
      if (claimed) {
        stopWaiting = waitForElement(id, landOn);
      }
    }

    function scheduleHighlight() {
      if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
      scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = null;
        highlightFromHash();
      });
    }

    // A fresh navigation lands with the hash already set; wait a frame so the target
    // has mounted before scrolling.
    scheduleHighlight();
    window.addEventListener("hashchange", scheduleHighlight);
    window.addEventListener("popstate", scheduleHighlight);
    return () => {
      if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
      stopWaiting?.();
      window.removeEventListener("hashchange", scheduleHighlight);
      window.removeEventListener("popstate", scheduleHighlight);
    };
  }, []);
}

/**
 * Watches the document until `id` appears, then hands the element over once. Returns the
 * canceller; it also cancels itself on arrival and after {@link REVEAL_TIMEOUT_MS}, so a
 * claim whose rows never load expires quietly instead of observing forever.
 */
function waitForElement(id: string, onFound: (element: HTMLElement) => void): () => void {
  const revealed = document.getElementById(id);
  if (revealed) {
    onFound(revealed);
    return () => {};
  }

  const observer = new MutationObserver(() => {
    const element = document.getElementById(id);
    if (!element) {
      return;
    }
    stop();
    onFound(element);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = window.setTimeout(stop, REVEAL_TIMEOUT_MS);

  function stop() {
    observer.disconnect();
    window.clearTimeout(timer);
  }

  return stop;
}
