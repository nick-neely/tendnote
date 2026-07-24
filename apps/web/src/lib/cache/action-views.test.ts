import { describe, expect, it } from "vitest";
import { actionCacheContract } from "./action-views";

describe("Action cache contract", () => {
  it("isolates owner collections and names the exact entity invalidation tag", () => {
    expect(actionCacheContract.owner("owner-a").tags).toEqual([
      "action:owner:owner-a",
      "action:owner:owner-a:linked-assets",
    ]);
    expect(actionCacheContract.owner("owner-b").tags).not.toEqual(
      actionCacheContract.owner("owner-a").tags,
    );
    expect(actionCacheContract.entity("owner-a", "action-a")).toBe(
      "action:owner:owner-a:action:action-a",
    );
  });
});
