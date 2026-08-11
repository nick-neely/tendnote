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
import {
  cleanup,
  type RenderOptions,
  render as testingLibraryRender,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach } from "vitest";
import { ReminderInstallationProvider } from "@/components/reminder-installation-context";

let matchMediaMatches = false;
/** Every list handed out this test, so {@link resizeMatchMedia} can reach their listeners. */
let matchMediaLists: { list: MediaQueryList; listeners: Set<() => void> }[] = [];

/**
 * Point `window.matchMedia` at a `true`/`false` answer for every query until the next test.
 * jsdom ships no matchMedia, so without this any `window.matchMedia(...)` call throws. Tests
 * that care about a specific query (reduced motion, a narrow breakpoint) set it before render.
 *
 * Sets the answer for lists created *after* it, which is why it is called before render. To
 * change the answer for a mounted component, use {@link resizeMatchMedia}.
 */
export function setMatchMedia(matches: boolean): void {
  matchMediaMatches = matches;
}

/**
 * Change the answer and tell the components that asked, the way a real resize would.
 *
 * A stub whose `addEventListener` drops the listener silently cannot fail a test about what
 * happens when the viewport changes under a mounted component - the component simply never
 * hears, and the assertion passes for the wrong reason. Registrations are real here, so a
 * breakpoint-gated surface can be driven across its breakpoint in both directions.
 */
export function resizeMatchMedia(matches: boolean): void {
  matchMediaMatches = matches;
  for (const entry of matchMediaLists) {
    Object.defineProperty(entry.list, "matches", { value: matches, configurable: true });
    for (const listener of entry.listeners) listener();
  }
}

function installMatchMedia(): void {
  window.matchMedia = (query: string): MediaQueryList => {
    const listeners = new Set<() => void>();
    const list = {
      matches: matchMediaMatches,
      media: query,
      onchange: null,
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    matchMediaLists.push({ list, listeners });
    return list;
  };
}

/**
 * jsdom implements no `ResizeObserver`, and several Radix primitives (Checkbox,
 * Select, and anything else built on `useSize`) construct one on mount. Without
 * this they throw inside a layout effect and the component never renders at all
 * - a harness gap rather than anything about the component under test. It
 * observes nothing, because jsdom has no layout to observe.
 */
function installResizeObserver(): void {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

installMatchMedia();
installResizeObserver();

afterEach(() => {
  cleanup();
  matchMediaMatches = false;
  matchMediaLists = [];
});

export function render(ui: ReactElement, options?: RenderOptions) {
  return testingLibraryRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ReminderInstallationProvider>{children}</ReminderInstallationProvider>
    ),
    ...options,
  });
}

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
