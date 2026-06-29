import type { RateLimitStore } from "./types";

export type FakeRateLimitStore = RateLimitStore & {
  /** Per-key hit counts, for assertions. */
  counts: Map<string, number>;
  /** When set, `increment` throws — exercises the limiter's fail-closed path. */
  setFailing: (failing: boolean) => void;
  reset: () => void;
};

/**
 * Deterministic in-memory counter for tests (ADR-0070). The limiter encodes the
 * window bucket in the key, so window resets fall out of the key changing — this
 * store needs no timers and stays fully deterministic. TTL is accepted but unused.
 */
export function createFakeRateLimitStore(): FakeRateLimitStore {
  const counts = new Map<string, number>();
  let failing = false;

  return {
    counts,
    setFailing(next) {
      failing = next;
    },
    reset() {
      counts.clear();
      failing = false;
    },
    async increment({ key }) {
      if (failing) {
        throw new Error("fake rate-limit store failure");
      }

      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
}
