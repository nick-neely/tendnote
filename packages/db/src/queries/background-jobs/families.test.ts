import { describe, expect, it } from "vitest";
import { BACKGROUND_JOB_TOPICS } from "../background-job-deliveries/topics";
import { BACKGROUND_JOB_FAMILIES } from "./families";

describe("background job family registry", () => {
  it("registers exactly one family per Postgres-owned job kind (completeness)", () => {
    // Adding a topic without registering its family should fail here (and at compile
    // time via the `_exhaustive` guard in families.ts). This keeps the registry an
    // explicit, closed enumeration rather than a generic event bus.
    expect(Object.keys(BACKGROUND_JOB_FAMILIES).sort()).toEqual(
      Object.keys(BACKGROUND_JOB_TOPICS).sort(),
    );
  });

  it("keeps each family's jobKind and mechanics aligned with its registry key", () => {
    for (const [kind, family] of Object.entries(BACKGROUND_JOB_FAMILIES)) {
      expect(family.jobKind).toBe(kind);
      // The deletion test: every real family exposes the same shared execution
      // mechanics. Removing this module would re-spread these across each family.
      expect(typeof family.resolveRuntimeMode).toBe("function");
      expect(typeof family.enqueueAndTrigger).toBe("function");
      expect(typeof family.claimJob).toBe("function");
      expect(typeof family.getJob).toBe("function");
      expect(typeof family.processJob).toBe("function");
      expect(typeof family.claimNextJob).toBe("function");
      expect(family.noun.length).toBeGreaterThan(0);
    }
  });

  it("resolves an explicit runtime mode ahead of environment defaults for every family", () => {
    for (const family of Object.values(BACKGROUND_JOB_FAMILIES)) {
      expect(family.resolveRuntimeMode("inline")).toBe("inline");
      expect(family.resolveRuntimeMode("enqueue_only")).toBe("enqueue_only");
    }
  });
});
