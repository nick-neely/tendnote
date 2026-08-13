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
  { kind: "owner-collection", collection: "people", ownerUserId: "owner-1" },
  {
    kind: "viewer-entity",
    entity: "person",
    entityId: "person-1",
    viewerUserId: "owner-1",
  },
  { kind: "visible-entity", entity: "person", entityId: "person-1" },
  { kind: "owner-collection", collection: "assets", ownerUserId: "owner-1" },
  { kind: "viewer-collection", collection: "assets", viewerUserId: "member-1" },
  {
    kind: "viewer-entity",
    entity: "asset",
    entityId: "asset-1",
    viewerUserId: "owner-1",
  },
  { kind: "visible-entity", entity: "asset", entityId: "asset-1" },
  { kind: "household-collection", collection: "assets", householdId: "household-1" },
  { kind: "linked-entity", entity: "asset", entityId: "asset-1" },
  { kind: "owner-collection", collection: "saved-items", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "household-planning", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "context-facts", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "orientation", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "global-recall", ownerUserId: "owner-1" },
  { kind: "owner-collection", collection: "briefs", ownerUserId: "owner-1" },
  { kind: "viewer-collection", collection: "saved-items", viewerUserId: "member-1" },
  {
    kind: "viewer-entity",
    entity: "saved-item",
    entityId: "saved-1",
    viewerUserId: "owner-1",
  },
  { kind: "visible-entity", entity: "saved-item", entityId: "saved-1" },
];

function expectRouteRevalidation() {
  expect(revalidatePath).toHaveBeenCalledWith("/account");
  expect(revalidatePath).toHaveBeenCalledWith("/account/contacts/import");
  expect(revalidatePath).toHaveBeenCalledWith("/account/discord");
  expect(revalidatePath).toHaveBeenCalledWith("/account/about-you");
  expect(revalidatePath).toHaveBeenCalledWith("/household");
  expect(revalidatePath).toHaveBeenCalledTimes(5);
}

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
    expect(updateTag).toHaveBeenCalledWith("people:owner:owner-1");
    expect(updateTag).toHaveBeenCalledWith("people:owner:owner-1:list");
    expect(updateTag).toHaveBeenCalledWith("people:owner:owner-1:person:person-1");
    expect(updateTag).toHaveBeenCalledWith("people:visible-person:person-1");
    expect(updateTag).toHaveBeenCalledWith("asset:viewer:member-1:collection");
    expect(updateTag).toHaveBeenCalledWith("asset:viewer:owner-1:asset:asset-1");
    expect(updateTag).toHaveBeenCalledWith("asset:visible:asset:asset-1");
    expect(updateTag).toHaveBeenCalledWith("asset:household:household-1:collection");
    expect(updateTag).toHaveBeenCalledWith("saved-item:viewer:member-1:collection");
    expect(updateTag).toHaveBeenCalledWith("saved-item:viewer:owner-1:item:saved-1");
    expect(updateTag).toHaveBeenCalledWith("saved-item:visible:item:saved-1");
    expect(updateTag).toHaveBeenCalledWith("account:owner:owner-1");
    expect(updateTag).toHaveBeenCalledWith("household-planning:viewer:owner-1");
    expect(updateTag).toHaveBeenCalledWith("briefs:owner:owner-1");
    expectRouteRevalidation();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("uses stale-while-revalidate tags for a background write", () => {
    reconcileAffectedScopes(scopes, { origin: "background" });

    expect(revalidateTag).toHaveBeenCalledWith("action:owner:owner-1", "max");
    expect(revalidateTag).toHaveBeenCalledWith("action:owner:owner-1:action:action-1", "max");
    expect(revalidateTag).toHaveBeenCalledWith("people:visible-person:person-1", "max");
    expect(revalidateTag).toHaveBeenCalledWith("account:owner:owner-1", "max");
    expect(revalidateTag).toHaveBeenCalledWith("household-planning:viewer:owner-1", "max");
    expect(revalidateTag).toHaveBeenCalledWith("briefs:owner:owner-1", "max");
    expect(updateTag).not.toHaveBeenCalled();
    expectRouteRevalidation();
  });
});
