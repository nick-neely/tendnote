import { describe, expect, it } from "vitest";
import { peopleCacheContract } from "./people-contract";

describe("People cache contract", () => {
  it("derives every read tag from the scopes People mutations return", () => {
    expect(peopleCacheContract.list({ ownerUserId: "owner-a" })).toEqual({
      tags: ["people:owner:owner-a", "people:owner:owner-a:list"],
    });
    expect(peopleCacheContract.detail({ callerUserId: "owner-a", personId: "person-1" })).toEqual({
      tags: [
        "people:owner:owner-a",
        "people:owner:owner-a:list",
        "people:owner:owner-a:person:person-1",
        "people:visible-person:person-1",
      ],
    });
  });
});
