import { describe, expect, it } from "vitest";
import { AssetConflictError, assertAssetRecordFresh } from "./assets";
import {
  type AssetAuthorityOperation,
  assertAssetChildOwnershipForm,
  assertAssetOperationForm,
  assetAttributionLabel,
  assetChildScopeForOwnership,
  householdOperationForAsset,
  householdOperationForAssetChild,
} from "./household-assets";

/**
 * The Asset half of the Phase Eight authority table, as pure rules. The
 * multi-member consequences of these mappings are exercised against a real
 * household in `packages/db/src/queries/assets/household-native.test.ts`.
 */
describe("how an Asset operation asks the proof", () => {
  it("reserves every content-affecting operation to authority, not audience", () => {
    // The point of the table: seeing an Asset is never the same standing as
    // re-authoring, re-addressing, or ending it.
    expect(householdOperationForAsset("view")).toBe("view");
    expect(householdOperationForAsset("edit")).toBe("update");
    expect(householdOperationForAsset("archive")).toBe("archive");
    expect(householdOperationForAsset("delete")).toBe("archive");
    expect(householdOperationForAsset("audience")).toBe("change_audience");
  });

  it("asks only for visibility when a member attaches their own detail", () => {
    expect(householdOperationForAsset("attach")).toBe("view");
  });

  it("gives an Asset no progress arm at all", () => {
    // Nothing about an Asset is "done" — maintenance is the linked Action's, and
    // an Asset that could be completed would be the maintenance dashboard #386
    // exists to not build.
    const operations: AssetAuthorityOperation[] = [
      "view",
      "edit",
      "archive",
      "delete",
      "audience",
      "attach",
    ];
    expect(operations.map(householdOperationForAsset)).not.toContain("progress");
  });

  it("maps a child's own operations without borrowing its parent's", () => {
    expect(householdOperationForAssetChild("view")).toBe("view");
    expect(householdOperationForAssetChild("edit")).toBe("update");
    expect(householdOperationForAssetChild("remove")).toBe("archive");
  });
});

describe("the operations a kind of Asset does not have", () => {
  it("refuses to permanently delete the household's own asset", () => {
    expect(() =>
      assertAssetOperationForm({ operation: "delete", ownership: "household_native" }),
    ).toThrow(/archived, not deleted/);
  });

  it("refuses to re-address an asset that is already everyone's", () => {
    expect(() =>
      assertAssetOperationForm({ operation: "audience", ownership: "household_native" }),
    ).toThrow(/already there for everyone/);
  });

  it("leaves both operations open on a member's own asset", () => {
    expect(() =>
      assertAssetOperationForm({ operation: "delete", ownership: "member_owned" }),
    ).not.toThrow();
    expect(() =>
      assertAssetOperationForm({ operation: "audience", ownership: "member_owned" }),
    ).not.toThrow();
  });

  it("refuses every operation for nobody by default", () => {
    // The form rules are about the record family, so an operation with no form
    // rule must be silent for both forms rather than quietly denying one.
    for (const ownership of ["member_owned", "household_native"] as const) {
      for (const operation of ["view", "edit", "archive", "attach"] as const) {
        expect(() => assertAssetOperationForm({ operation, ownership })).not.toThrow();
      }
    }
  });
});

describe("which details a kind of Asset can hold", () => {
  it("refuses a workspace-owned detail on a member's own asset", () => {
    // Otherwise the member's departure would take the household's record with it.
    expect(() =>
      assertAssetChildOwnershipForm({
        childOwnership: "household_native",
        assetOwnership: "member_owned",
      }),
    ).toThrow(/household detail belongs on a household asset/);
  });

  it("allows a member's private detail on the household's asset", () => {
    expect(() =>
      assertAssetChildOwnershipForm({
        childOwnership: "member_owned",
        assetOwnership: "household_native",
      }),
    ).not.toThrow();
  });

  it("makes a household detail household-visible whatever was asked for", () => {
    expect(assetChildScopeForOwnership("household_native", "private")).toBe("household");
    expect(assetChildScopeForOwnership("household_native", undefined)).toBe("household");
  });

  it("leaves a member's own detail wherever they put it", () => {
    expect(assetChildScopeForOwnership("member_owned", "private")).toBe("private");
    expect(assetChildScopeForOwnership("member_owned", undefined)).toBeUndefined();
  });
});

describe("a write that lost a race", () => {
  const current = { revision: 4, lastActorUserId: "user-ben" };

  it("keeps the draft and reports what is there now, with who put it there", () => {
    try {
      assertAssetRecordFresh({
        expectedRevision: 3,
        current,
        currentValue: "Kitchen refrigerator",
        message: "Someone else changed this.",
      });
      expect.unreachable("a stale write must not pass");
    } catch (error) {
      expect(error).toBeInstanceOf(AssetConflictError);
      expect((error as AssetConflictError).conflict).toEqual({
        currentValue: "Kitchen refrigerator",
        actorUserId: "user-ben",
        revision: 4,
      });
    }
  });

  it("passes when the draft was written against what is there", () => {
    expect(() =>
      assertAssetRecordFresh({
        expectedRevision: 4,
        current,
        currentValue: null,
        message: "Someone else changed this.",
      }),
    ).not.toThrow();
  });

  it("treats no expectation as a deliberate replace", () => {
    // The escape hatch the conflict copy offers: a writer who has *seen* the
    // current value may overwrite it on purpose.
    expect(() =>
      assertAssetRecordFresh({
        expectedRevision: undefined,
        current,
        currentValue: null,
        message: "Someone else changed this.",
      }),
    ).not.toThrow();
  });
});

describe("saying whose asset this is", () => {
  it("credits the household, never the member who typed it", () => {
    expect(
      assetAttributionLabel({
        ownership: "household_native",
        owned: true,
        ownerName: "Ana",
      }),
    ).toEqual({ kind: "household" });
  });

  it("names the owner of a record shared with you", () => {
    expect(
      assetAttributionLabel({ ownership: "member_owned", owned: false, ownerName: "Mara" }),
    ).toEqual({ kind: "shared_by", label: "Shared by Mara" });
  });

  it("falls back to a bare fact rather than an id when the name is unknown", () => {
    expect(
      assetAttributionLabel({ ownership: "member_owned", owned: false, ownerName: null }),
    ).toEqual({ kind: "shared_by", label: "Shared by a household member" });
  });

  it("says nothing about your own asset", () => {
    expect(
      assetAttributionLabel({ ownership: "member_owned", owned: true, ownerName: "Nick" }),
    ).toBeNull();
  });
});
