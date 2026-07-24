import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, updateTag } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath, updateTag }));

import { invalidateReviewOwner, invalidateTodayOwner } from "./today-review-mutation-scopes";

describe("Today and Review mutation scopes", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    updateTag.mockReset();
  });

  it("expires both owner projections before retaining the path safety net", () => {
    expect(invalidateTodayOwner("owner-a")).toEqual([
      { kind: "today-owner", ownerUserId: "owner-a" },
      { kind: "review-owner", ownerUserId: "owner-a" },
    ]);
    expect(updateTag).toHaveBeenCalledWith("today:owner:owner-a");
    expect(updateTag).toHaveBeenCalledWith("review:owner:owner-a");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("expires Review without broadening an unrelated mutation to Today", () => {
    expect(invalidateReviewOwner("owner-b")).toEqual([
      { kind: "review-owner", ownerUserId: "owner-b" },
    ]);
    expect(updateTag).toHaveBeenCalledWith("review:owner:owner-b");
    expect(updateTag).not.toHaveBeenCalledWith("today:owner:owner-b");
  });
});
