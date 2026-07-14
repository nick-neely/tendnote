import { describe, expect, it } from "vitest";
import { type EvidenceDestination, resolveEvidenceDestination } from "./asset-evidence-destination";

/**
 * The destination-resolution rule behind Eve's chat capture (#201): a capture
 * must land somewhere the user confirmed. One existing candidate is "clear from
 * context" and gets preselected (still confirmed before anything writes);
 * several candidates mean the user chooses; none means the only path is naming
 * something new — a review-gated Suggested Asset, never a silent write.
 */

function assetDestination(id: string, name: string): EvidenceDestination {
  return {
    targetKind: "asset",
    id,
    name,
    kind: "appliance",
    kindLabel: "Appliance",
    scope: "private",
    visibilityLabel: "Only me",
  };
}

function reviewDestination(groupId: string, assetName: string): EvidenceDestination {
  return {
    targetKind: "review",
    groupId,
    assetName,
    kind: "appliance",
    kindLabel: "Appliance",
    scope: "private",
  };
}

describe("resolveEvidenceDestination (#201)", () => {
  it("preselects the destination when exactly one candidate exists", () => {
    const only = assetDestination("asset-1", "Refrigerator");

    expect(resolveEvidenceDestination([only])).toEqual({ kind: "clear", destination: only });
  });

  it("treats a single open review group as the clear destination too", () => {
    const only = reviewDestination("group-1", "Fridge filter");

    expect(resolveEvidenceDestination([only])).toEqual({ kind: "clear", destination: only });
  });

  it("asks the user to choose when several candidates exist", () => {
    const resolution = resolveEvidenceDestination([
      assetDestination("asset-1", "Refrigerator"),
      reviewDestination("group-1", "Fridge filter"),
    ]);

    expect(resolution).toEqual({ kind: "choose" });
  });

  it("routes to the new-asset path when nothing exists yet", () => {
    expect(resolveEvidenceDestination([])).toEqual({ kind: "new_only" });
  });
});
