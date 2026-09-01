import { describe, expect, it } from "vitest";
import {
  affectedScopeSchema,
  affectedScopesForAccount,
  affectedScopesForBriefs,
  affectedScopesForContextFact,
  affectedScopesForOwnerSurfaces,
  affectedScopesForReminder,
} from "./affected-scopes";

describe("remaining affected-scope contracts", () => {
  it("accepts the viewer-scoped Household planning collection on the wire", () => {
    expect(
      affectedScopeSchema.parse({
        kind: "owner-collection",
        collection: "household-planning",
        ownerUserId: "owner-1",
      }),
    ).toEqual({
      kind: "owner-collection",
      collection: "household-planning",
      ownerUserId: "owner-1",
    });
  });

  it("names the Context Fact projections that a mutation invalidates", () => {
    expect(affectedScopesForContextFact({ ownerUserId: "owner-1" })).toEqual([
      { kind: "owner-collection", collection: "context-facts", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "orientation", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
    ]);
  });

  it("fans household Context Fact invalidation out to every other active member", () => {
    expect(
      affectedScopesForContextFact({
        ownerUserId: "owner-1",
        householdId: "home-1",
        householdMemberUserIds: ["owner-1", "member-1"],
      }),
    ).toEqual([
      { kind: "owner-collection", collection: "context-facts", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "orientation", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "review", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "account", ownerUserId: "owner-1" },
      { kind: "owner-collection", collection: "context-facts", ownerUserId: "member-1" },
      { kind: "owner-collection", collection: "orientation", ownerUserId: "member-1" },
      { kind: "owner-collection", collection: "review", ownerUserId: "member-1" },
      { kind: "owner-collection", collection: "global-recall", ownerUserId: "member-1" },
      { kind: "owner-collection", collection: "account", ownerUserId: "member-1" },
      { kind: "household-collection", collection: "context-facts", householdId: "home-1" },
    ]);
  });

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
  ] as const)(
    "adds the changed %s record projection to Account and owner surfaces",
    (recordKind, entity) => {
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
    },
  );

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
