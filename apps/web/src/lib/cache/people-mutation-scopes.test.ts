import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, updateTag } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath, updateTag }));

import { peopleMutationScopes, updatePeopleMutationScopes } from "./people-mutation-scopes";

describe("People mutation scopes", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    updateTag.mockReset();
  });

  it("returns the owner collection and affected entity scopes for a person write", () => {
    expect(
      peopleMutationScopes.forPerson({ ownerUserId: "owner-a", personId: "person-1" }),
    ).toEqual([
      { kind: "people-owner", ownerUserId: "owner-a" },
      { kind: "people-collection", ownerUserId: "owner-a" },
      { kind: "person", ownerUserId: "owner-a", personId: "person-1" },
      { kind: "person-visible-to-viewers", personId: "person-1" },
    ]);
  });

  it("synchronously expires every returned tag before retaining the path safety net", () => {
    updatePeopleMutationScopes(
      peopleMutationScopes.forPerson({ ownerUserId: "owner-a", personId: "person-1" }),
    );

    expect(updateTag).toHaveBeenCalledWith("people:owner:owner-a");
    expect(updateTag).toHaveBeenCalledWith("people:owner:owner-a:list");
    expect(updateTag).toHaveBeenCalledWith("people:owner:owner-a:person:person-1");
    expect(updateTag).toHaveBeenCalledWith("people:visible-person:person-1");
    expect(revalidatePath).toHaveBeenCalledWith("/people");
    expect(revalidatePath).toHaveBeenCalledWith("/people/person-1");
  });
});
