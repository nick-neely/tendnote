// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeepLinkHighlight } from "@/lib/use-deep-link-highlight";
import { render, setMatchMedia } from "@/test/dom";

/**
 * DOM-level coverage for the deep-link scroll-highlight hook (#186), previously untested
 * below the source level. The hook is the landing half of the Action Today → ledger hop
 * (`/actions#action-<id>`): on mount and on `hashchange` it scrolls to, focuses, and
 * pulses the row named by the URL hash. jsdom implements none of scroll/animate, so we
 * spy on `scrollIntoView` and `animate` to observe the calls, and read `document.activeElement`
 * for the real focus move jsdom does perform.
 */

function Harness({ targetId }: { targetId: string }) {
  useDeepLinkHighlight();
  return (
    <div id={targetId} tabIndex={-1}>
      the row
    </div>
  );
}

// Captured so the prototype patches below are restored after each test rather than left
// mutated for the rest of the (jsdom) worker's lifetime.
const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalAnimate = Element.prototype.animate;

beforeEach(() => {
  // Run rAF synchronously so the hook's "wait a frame for the target to mount" runs within
  // the render's effect flush, keeping the assertions deterministic (no real 16ms timer).
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // jsdom implements neither; provide spies so the hook's calls are observable.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.animate = vi.fn() as unknown as Element["animate"];
});

afterEach(() => {
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  Element.prototype.animate = originalAnimate;
  window.location.hash = "";
});

describe("useDeepLinkHighlight", () => {
  it("scrolls to, focuses, and pulses the hash target on mount", () => {
    window.location.hash = "#action-42";
    setMatchMedia(false); // motion allowed

    render(<Harness targetId="action-42" />);
    const target = document.getElementById("action-42");

    expect(target?.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(document.activeElement).toBe(target);
    expect(target?.animate).toHaveBeenCalledTimes(1);
  });

  it("honors reduced motion: still scrolls and focuses, but does not pulse", () => {
    window.location.hash = "#action-42";
    setMatchMedia(true); // prefers-reduced-motion: reduce

    render(<Harness targetId="action-42" />);
    const target = document.getElementById("action-42");

    expect(target?.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    expect(document.activeElement).toBe(target);
    expect(target?.animate).not.toHaveBeenCalled();
  });

  it("does nothing when the hash names no element on the page", () => {
    window.location.hash = "#action-does-not-exist";

    render(<Harness targetId="action-42" />);
    const target = document.getElementById("action-42");

    expect(target?.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(target);
  });

  it("opens every collapsed disclosure containing the target before landing", () => {
    // A resolved action row lives inside a closed <details>; the deep link from an
    // asset profile must reveal it rather than landing at the top of the page (#199).
    window.location.hash = "#action-9";
    setMatchMedia(true);

    function DetailsHarness() {
      useDeepLinkHighlight();
      return (
        <details>
          <summary>Resolved</summary>
          <details>
            <summary>Inner</summary>
            <div id="action-9" tabIndex={-1}>
              the resolved row
            </div>
          </details>
        </details>
      );
    }
    render(<DetailsHarness />);

    const target = document.getElementById("action-9");
    for (const details of Array.from(document.querySelectorAll("details"))) {
      expect(details.open).toBe(true);
    }
    expect(target?.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
  });

  it("re-highlights when the hash changes in place", () => {
    window.location.hash = "";
    render(<Harness targetId="action-7" />);
    const target = document.getElementById("action-7");
    expect(target?.scrollIntoView).not.toHaveBeenCalled();

    window.location.hash = "#action-7";
    window.dispatchEvent(new Event("hashchange"));

    expect(target?.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(document.activeElement).toBe(target);
  });
});
