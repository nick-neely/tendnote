import {
  NAVIGATION_ACTION,
  PRIMARY_OWNER,
  PRIMARY_PERSON,
} from "@tendnote/db/instant/fixture-data";
import type { MarkerSpec } from "./instrumentation";

/**
 * What each destination in the matrix promises at 100 ms, and what it must have
 * settled into afterwards.
 *
 * Three things are distinguished deliberately, because conflating them is how an
 * empty-shell pass happens:
 *
 * - **`shell`** — the truthful Shaped Reserve of ADR 0207: the destination's own
 *   heading and static controls, present before any owner data exists. Asserting
 *   only this would pass against a blank frame, which is why it never appears
 *   without `authoritative`.
 * - **`deferred`** — owner data that must *not* be on screen inside `instant()`.
 *   This is the assertion that proves the lock is real: without
 *   `exposeTestingApiInProductionBuild`, `instant()` no-ops, the streamed data
 *   arrives inside the callback, and these fail.
 * - **`authoritative`** — the owner-scoped content that proves the destination
 *   reached real, settled state rather than a convincing placeholder.
 *
 * Some destinations legitimately have no `deferred` entry: under Cache
 * Components a fully cache-backed destination is *supposed* to be complete
 * inside `instant()`. Those still carry `authoritative`, and the suite-wide lock
 * proof lives on the destinations that do defer.
 */
export type DestinationContract = {
  key: string;
  /** `pathname + search` after navigating. */
  url: string;
  shell: MarkerSpec[];
  deferred?: MarkerSpec[];
  authoritative: MarkerSpec[];
  /**
   * What the destination can commit from cache alone.
   *
   * `"cache"` — the reusable shell is in the prefetch cache, so the navigation
   * commits inside `instant()` and the truthful shell is asserted there.
   *
   * `"dynamic-response"` — it is not, so under the lock the navigation cannot
   * commit at all. Recording this rather than omitting the row keeps the gap
   * visible and makes the suite fail if it changes in either direction. See
   * `docs/verification/nextjs-16-3-instant-navigation.md`.
   */
  instantContract?: "cache" | "dynamic-response";
};

/** No Shaped Reserve may remain once a destination is authoritative. */
export const NO_REMAINING_RESERVE: MarkerSpec = {
  selector: "[aria-busy='true']",
  absent: true,
};

export const DESKTOP_HOME: DestinationContract = {
  key: "desktop-home",
  url: "/",
  // Both markers are true of the reserve *and* of the settled rail: the
  // assistant reserve reuses the live panel's own chrome, and the rail reserve
  // renders the real tab bar with `<span>` labels rather than tabs. A marker
  // that only matched one of the two would pass or fail on prefetch timing.
  shell: [
    { selector: "h2", text: "Assistant" },
    { selector: "[aria-label='Loading the context rail'], [role='tablist']" },
  ],
  // The rail opens on the first panel that holds something, and the only thing
  // waiting for this owner is their review item — so Home settles with Review
  // open, and the marker is the panel the owner actually sees. Asserting the
  // Today panel's heading would now be asserting hidden markup: inactive panels
  // stay mounted for their scroll position but are `hidden`, and a marker has to
  // be on screen to count.
  authoritative: [
    { selector: "[role='tabpanel']", text: PRIMARY_OWNER.review.memoryContent },
    NO_REMAINING_RESERVE,
  ],
};

export const PEOPLE: DestinationContract = {
  key: "people",
  url: "/people",
  shell: [{ selector: "h1", text: "People" }],
  deferred: [{ selector: "a[href^='/people/']", absent: true }],
  authoritative: [
    { selector: "a[href^='/people/']", text: PRIMARY_PERSON.displayName },
    { selector: "p", text: `${PRIMARY_OWNER.people.length} people you're keeping in mind.` },
    NO_REMAINING_RESERVE,
  ],
};

export const PERSON_DETAIL: DestinationContract = {
  key: "person-detail",
  url: `/people/${PRIMARY_PERSON.id}`,
  // "Person" rather than the name: the reserve cannot know whose page this is
  // without reading owner data, so ADR 0207's truthful heading is the generic
  // destination name. Recorded as a finding rather than papered over.
  shell: [{ selector: "h1", anyText: ["Person", PRIMARY_PERSON.displayName] }],
  // No `deferred` marker, deliberately. The person core view is `use cache`
  // backed, and `instant()` assumes a warm cache: once the server has produced
  // that entry, the name is *supposed* to be available inside the callback.
  // Asserting its absence would be asserting that the cache contract failed.
  // The suite's proof that the lock is engaged is the server-side check in
  // `support/lock-proof.ts`, which does not depend on cache warmth.
  authoritative: [
    { selector: "h1", text: PRIMARY_PERSON.displayName },
    { selector: "[role='tab']", text: "Snapshot" },
    NO_REMAINING_RESERVE,
  ],
};

export const ACTIONS: DestinationContract = {
  key: "actions",
  url: "/actions",
  shell: [{ selector: "h1", text: "Actions" }],
  deferred: [{ selector: "article[id^='action-']", absent: true }],
  authoritative: [
    { selector: "article[id^='action-']", text: NAVIGATION_ACTION.title },
    NO_REMAINING_RESERVE,
  ],
};

export const MOBILE_TODAY: DestinationContract = {
  key: "mobile-today",
  url: "/",
  shell: [{ selector: "h1", text: "Today" }],
  authoritative: [
    { selector: "[data-testid='today-ledger']" },
    { selector: "article[data-today-ledger-row]", text: NAVIGATION_ACTION.title },
    NO_REMAINING_RESERVE,
  ],
};

export const MOBILE_REVIEW: DestinationContract = {
  key: "mobile-review",
  url: "/?tab=review",
  // Review is the one persistent-navigation destination expressed as a search
  // param rather than a path, and Next does not emit a segment (shell-only)
  // prefetch for a URL with a query: the source shell fetches it with
  // `next-router-prefetch: 3` and no `next-router-segment-prefetch`, where every
  // other destination gets `/_tree`. So there is no reusable shell to commit
  // from, and under the instant lock this navigation does not commit at all.
  instantContract: "dynamic-response",
  shell: [{ selector: "h1", text: "Review" }],
  authoritative: [
    { selector: "section", text: PRIMARY_OWNER.review.memoryContent },
    NO_REMAINING_RESERVE,
  ],
};
