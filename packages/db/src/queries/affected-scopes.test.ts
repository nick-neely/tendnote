import { describe, expect, it } from "vitest";
import {
  affectedScopesForAccount,
  affectedScopesForBriefs,
  affectedScopesForOwnerSurfaces,
  affectedScopesForReminder,
} from "./affected-scopes";

describe("remaining affected-scope contracts", () => {
  it("names Account, Briefs, Today, and Review as data rather than routes", () => {
    expect(affectedScopesForAccount("owner-1")).toEqual([
      { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
    ]);
    expect(affectedScopesForBriefs("owner-1")).toEqual([
      { kind: "owner-collection", collection: "briefs", ownerUserId: "owner-1" },
    ]);
    expect(affectedScopesForOwnerSurfaces("owner-1")).toEqual([
      { kind: "owner-collection", collection: "today", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
    ]);
  });

  it.each([
    ["general_action", "general-action"],
    ["routine", "general-action"],
    ["saved_item", "saved-item"],
  ] as const)("adds the changed %s record projection to Account and owner surfaces", (recordKind, entity) => {
    expect(
      affectedScopesForReminder({
        ownerUserId: "owner-1",
        recordKind,
        recordId: "record-1",
      }),
    ).toEqual([
      { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
      {
        kind: "viewer-entity",
        entity,
        entityId: "record-1",
        viewerUserId: "owner-1",
      },
      { kind: "owner-collection", collection: "today", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
    ]);
  });

  it("keeps a Follow-Up reminder on Account and owner surfaces until person context is available", () => {
    expect(
      affectedScopesForReminder({
        ownerUserId: "owner-1",
        recordKind: "follow_up",
        recordId: "followup-1",
      }),
    ).toEqual([
      { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "today", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
    ]);
  });
});
