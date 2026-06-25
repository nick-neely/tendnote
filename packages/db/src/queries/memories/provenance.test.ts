import { describe, expect, it } from "vitest";
import { createInMemoryMemoryStore } from "../memories";

describe("memory provenance enforcement", () => {
  it("rejects a provenance-free memory write at the store boundary", async () => {
    const store = createInMemoryMemoryStore();

    await expect(
      // A direct store caller that omits the source record must still be rejected,
      // so provenance is guaranteed rather than merely conventional (ADR 0022).
      store.createMemory({
        personId: "person-1",
        ownerUserId: "user-1",
        content: "Maya prefers short texts.",
        // sourceRecordId intentionally omitted
      } as never),
    ).rejects.toThrow();
  });
});
