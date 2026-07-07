/**
 * Shared DOM component-test harness for `*.dom.test.tsx` files (ADR 0161 follow-up, #191).
 *
 * The repo's default vitest environment is `node`: every pre-existing web test asserts a
 * serialized view model via `renderToStaticMarkup`, and those suites stay byte-identical.
 * A component test opts into a real DOM *per file* with a `// @vitest-environment jsdom`
 * docblock and imports its render surface from here, so the harness is purely additive —
 * no global vitest config change gates the existing node suites.
 *
 * Importing this module:
 *   - registers React Testing Library's `cleanup` after each test (the repo does not enable
 *     vitest `globals`, so RTL's own auto-cleanup — which keys off a global `afterEach` —
 *     never fires; we wire it explicitly), and
 *   - installs a minimal `window.matchMedia` stub, which jsdom does not implement and which
 *     client code under test calls on mount (e.g. `useDeepLinkHighlight`'s reduced-motion
 *     check). Default answer is `false`; a test flips it with {@link setMatchMedia}.
 *
 * Honest scope: jsdom has no layout engine — it computes no CSS, media queries, or box
 * sizes. These tests prove *behavior and reachability* (state changes, handler/server-action
 * calls, which elements are in the document and operable), never pixel layout. A
 * "narrow-viewport" assertion here confirms the mobile-first base layout renders its controls
 * reachable and operable, since jsdom reflects the un-broken (mobile) style layer.
 */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

let matchMediaMatches = false;

/**
 * Point `window.matchMedia` at a `true`/`false` answer for every query until the next test.
 * jsdom ships no matchMedia, so without this any `window.matchMedia(...)` call throws. Tests
 * that care about a specific query (reduced motion, a narrow breakpoint) set it before render.
 */
export function setMatchMedia(matches: boolean): void {
  matchMediaMatches = matches;
}

function installMatchMedia(): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: matchMediaMatches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

installMatchMedia();

afterEach(() => {
  cleanup();
  matchMediaMatches = false;
});

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
