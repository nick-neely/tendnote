import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, updateTag } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath, updateTag }));

import { invalidateActionMutation } from "./action-mutation-scopes";

describe("Action mutation cache scopes", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    updateTag.mockReset();
  });

  it("expires the owner collection, exact entity, linked details, Today, and Review before paths", () => {
    expect(invalidateActionMutation({ ownerUserId: "owner-a", actionId: "action-a" })).toEqual([
      { kind: "action-owner", ownerUserId: "owner-a" },
      { kind: "action-entity", ownerUserId: "owner-a", actionId: "action-a" },
      { kind: "today-owner", ownerUserId: "owner-a" },
      { kind: "review-owner", ownerUserId: "owner-a" },
    ]);
    expect(updateTag).toHaveBeenCalledWith("action:owner:owner-a");
    expect(updateTag).toHaveBeenCalledWith("action:owner:owner-a:action:action-a");
    expect(updateTag).toHaveBeenCalledWith("action:owner:owner-a:linked-assets");
    expect(updateTag).toHaveBeenCalledWith("today:owner:owner-a");
    expect(updateTag).toHaveBeenCalledWith("review:owner:owner-a");
    expect(revalidatePath).toHaveBeenCalledWith("/actions");
    expect(revalidatePath).toHaveBeenCalledWith("/actions/today");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});
