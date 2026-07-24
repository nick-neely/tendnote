import { describe, expect, it } from "vitest";
import { peopleCacheContract } from "./people-contract";

describe("People cache contract", () => {
  it("keeps owner, caller visibility, entity, filter, and pagination dimensions in keys and tags", () => {
    expect(peopleCacheContract.list({ ownerUserId: "owner-a", limit: 50 })).toEqual({
      key: ["people", "list", "owner-a", 50],
      tags: ["people:owner:owner-a", "people:owner:owner-a:list"],
    });
    expect(peopleCacheContract.detail({ callerUserId: "owner-a", personId: "person-1" })).toEqual({
      key: ["people", "detail", "owner-a", "person-1"],
      tags: [
        "people:owner:owner-a",
        "people:owner:owner-a:list",
        "people:owner:owner-a:person:person-1",
        "people:viewer:owner-a",
        "people:viewer:owner-a:person:person-1",
        "people:visible-person:person-1",
      ],
    });
    expect(
      peopleCacheContract.detail({ callerUserId: "owner-b", personId: "person-1" }).key,
    ).not.toEqual(
      peopleCacheContract.detail({ callerUserId: "owner-a", personId: "person-1" }).key,
    );
  });
});
