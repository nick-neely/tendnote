import { describe, expect, it } from "vitest";
import { createFakeRateLimitStore } from "./fake-store";

describe("fake rate-limit store", () => {
  it("increments deterministically per key", async () => {
    const store = createFakeRateLimitStore();

    expect(await store.increment({ key: "a", ttlSeconds: 60 })).toBe(1);
    expect(await store.increment({ key: "a", ttlSeconds: 60 })).toBe(2);
    // A different key has its own counter.
    expect(await store.increment({ key: "b", ttlSeconds: 60 })).toBe(1);
    expect(store.counts.get("a")).toBe(2);
  });

  it("throws when set to fail, and reset clears state", async () => {
    const store = createFakeRateLimitStore();
    await store.increment({ key: "a", ttlSeconds: 60 });

    store.setFailing(true);
    await expect(store.increment({ key: "a", ttlSeconds: 60 })).rejects.toThrow();

    store.reset();
    expect(store.counts.size).toBe(0);
    expect(await store.increment({ key: "a", ttlSeconds: 60 })).toBe(1);
  });
});
