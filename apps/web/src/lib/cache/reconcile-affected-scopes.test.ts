import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, revalidateTag, updateTag } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath, revalidateTag, updateTag }));

import { reconcileAffectedScopes } from "./reconcile-affected-scopes";

const scopes: AffectedScope[] = [
  {
    kind: "viewer-collection",
    collection: "general-actions",
    viewerUserId: "owner-1",
  },
  {
    kind: "viewer-entity",
    entity: "general-action",
    entityId: "action-1",
    viewerUserId: "owner-1",
  },
  { kind: "owner-collection", collection: "today", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
];

describe("affected-scope reconciliation", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    revalidateTag.mockReset();
    updateTag.mockReset();
  });

  it("uses updateTag for a user-originated Server Action before returning", () => {
    reconcileAffectedScopes(scopes, { origin: "owner-action" });

    expect(updateTag).toHaveBeenCalledWith("action:owner:owner-1");
    expect(updateTag).toHaveBeenCalledWith("action:owner:owner-1:linked-assets");
    expect(updateTag).toHaveBeenCalledWith("action:owner:owner-1:action:action-1");
    expect(updateTag).toHaveBeenCalledWith("today:owner:owner-1");
    expect(updateTag).toHaveBeenCalledWith("review:owner:owner-1");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("uses stale-while-revalidate tags for a background write", () => {
    reconcileAffectedScopes(scopes, { origin: "background" });

    expect(revalidateTag).toHaveBeenCalledWith("action:owner:owner-1", "max");
    expect(revalidateTag).toHaveBeenCalledWith("action:owner:owner-1:action:action-1", "max");
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
