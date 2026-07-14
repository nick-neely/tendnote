import type { RelatedAssetLink } from "@tendnote/db/queries/assets";
import { describe, expect, it } from "vitest";
import { toAssetPersonLinkView, toRelatedAssetLinkView } from "@/lib/asset-link-view";

function linkEntry(overrides: Partial<RelatedAssetLink> = {}): RelatedAssetLink {
  return {
    linkId: "link-1",
    relation: "fits",
    direction: "outgoing",
    otherAsset: {
      id: "asset-2",
      ownerUserId: "user-1",
      name: "Refrigerator",
      kind: "appliance",
      status: "active",
      scope: "private",
      householdId: null,
      archivedAt: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
    pending: false,
    owned: true,
    createdAt: new Date("2026-07-02T00:00:00Z"),
    ...overrides,
  };
}

describe("toRelatedAssetLinkView", () => {
  it("phrases an outgoing link as a sentence leading with the relation", () => {
    const view = toRelatedAssetLinkView(linkEntry());
    // "Fits Refrigerator" — relation first, then the linked name.
    expect(view.phraseBefore).toBe("Fits ");
    expect(view.phraseAfter).toBe("");
    expect(view.otherAssetName).toBe("Refrigerator");
    expect(view.otherAssetId).toBe("asset-2");
  });

  it("phrases an incoming link as the other asset relating to this one", () => {
    const view = toRelatedAssetLinkView(linkEntry({ direction: "incoming" }));
    // "Refrigerator fits this" — name first, relation pointing back.
    expect(view.phraseBefore).toBe("");
    expect(view.phraseAfter).toBe(" fits this");
  });

  it("uses the human relation label for underscored relations", () => {
    const view = toRelatedAssetLinkView(linkEntry({ relation: "stored_with" }));
    expect(view.phraseBefore).toBe("Stored with ");
    const incoming = toRelatedAssetLinkView(
      linkEntry({ relation: "part_of", direction: "incoming" }),
    );
    expect(incoming.phraseAfter).toBe(" part of this");
  });

  it("carries pending and owned through for the review controls", () => {
    const view = toRelatedAssetLinkView(linkEntry({ pending: true, owned: false }));
    expect(view.pending).toBe(true);
    expect(view.owned).toBe(false);
  });
});

describe("toAssetPersonLinkView", () => {
  it("names the person with the contextual relation phrase", () => {
    const view = toAssetPersonLinkView({
      linkId: "person-link-1",
      relation: "borrowed",
      person: { id: "person-1", displayName: "Marcus" },
      createdAt: new Date("2026-07-02T00:00:00Z"),
    });
    expect(view).toEqual({
      linkId: "person-link-1",
      personId: "person-1",
      displayName: "Marcus",
      relationLabel: "borrowed it",
    });
  });
});
