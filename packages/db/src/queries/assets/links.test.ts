import { AssetValidationError } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  createAuditKindsReader,
  seedOwnerMemberHousehold,
  seedPerson,
  seedSourceRecord,
} from "./asset-test-fixtures";
import { createInMemoryAssetReviewLifecycleStore } from "./in-memory-review-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAssetContextLinks } from "./links";

const OWNER = "user-1";
const MEMBER = "user-member";

function setup() {
  const store = createInMemoryAssetReviewLifecycleStore();
  const links = createAssetContextLinks(store);
  const lifecycle = createAssetLifecycle(store);

  function seedAsset(overrides: Partial<Parameters<typeof lifecycle.createAsset>[0]> = {}) {
    return lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator",
      kind: "appliance",
      ...overrides,
    });
  }

  const seedHousehold = () => seedOwnerMemberHousehold(store, OWNER, MEMBER);
  const auditKinds = createAuditKindsReader(lifecycle, OWNER);

  return { store, links, lifecycle, seedAsset, seedHousehold, auditKinds };
}

describe("addAssetLink (explicit)", () => {
  it("creates an active link between two visible assets and audits it on the subject asset", async () => {
    const { links, seedAsset, auditKinds } = setup();
    const fridge = await seedAsset();
    const filter = await seedAsset({ name: "Water filter", kind: "item" });

    const link = await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });

    expect(link.status).toBe("active");
    expect(link.ownerUserId).toBe(OWNER);
    await expect(auditKinds(filter.id)).resolves.toContain("link_added");
  });

  it("rejects linking an asset to itself with a curated message", async () => {
    const { links, seedAsset } = setup();
    const fridge = await seedAsset();

    await expect(
      links.addAssetLink({
        actorUserId: OWNER,
        fromAssetId: fridge.id,
        toAssetId: fridge.id,
        relation: "uses",
      }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("fails closed when either side is not visible to the actor", async () => {
    const { links, seedAsset, lifecycle } = setup();
    const fridge = await seedAsset();
    // A stranger's private asset: invisible, indistinguishable from missing.
    const stranger = await lifecycle.createAsset({
      ownerUserId: "user-stranger",
      name: "Their fridge",
      kind: "appliance",
    });

    await expect(
      links.addAssetLink({
        actorUserId: OWNER,
        fromAssetId: fridge.id,
        toAssetId: stranger.id,
        relation: "fits",
      }),
    ).rejects.toThrow("Asset not found.");
  });

  it("requires an active subject but allows an archived object — a new asset replaces a retired one", async () => {
    const { links, lifecycle, seedAsset } = setup();
    const oldFridge = await seedAsset({ name: "Old fridge" });
    const newFridge = await seedAsset({ name: "New fridge" });
    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: oldFridge.id });

    const link = await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: newFridge.id,
      toAssetId: oldFridge.id,
      relation: "replaces",
    });
    expect(link.status).toBe("active");

    await expect(
      links.addAssetLink({
        actorUserId: OWNER,
        fromAssetId: oldFridge.id,
        toAssetId: newFridge.id,
        relation: "stored_with",
      }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("is idempotent per (from, to, relation) — re-adding returns the existing link", async () => {
    const { links, seedAsset } = setup();
    const fridge = await seedAsset();
    const filter = await seedAsset({ name: "Water filter", kind: "item" });

    const first = await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });
    const second = await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });

    expect(second.id).toBe(first.id);
  });
});

describe("listRelatedAssetLinks", () => {
  it("resolves the perspective on each profile: outgoing on the subject, incoming on the object", async () => {
    const { links, seedAsset } = setup();
    const fridge = await seedAsset();
    const filter = await seedAsset({ name: "Water filter", kind: "item" });
    await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });

    const fromFilter = await links.listRelatedAssetLinks({
      callerUserId: OWNER,
      assetId: filter.id,
    });
    expect(fromFilter).toHaveLength(1);
    expect(fromFilter[0]).toMatchObject({
      direction: "outgoing",
      relation: "fits",
      pending: false,
      owned: true,
    });
    expect(fromFilter[0]?.otherAsset.id).toBe(fridge.id);

    const fromFridge = await links.listRelatedAssetLinks({
      callerUserId: OWNER,
      assetId: fridge.id,
    });
    expect(fromFridge[0]).toMatchObject({ direction: "incoming", relation: "fits" });
    expect(fromFridge[0]?.otherAsset.id).toBe(filter.id);
  });

  it("returns nothing for an asset the caller cannot see", async () => {
    const { links, seedAsset } = setup();
    const fridge = await seedAsset();

    await expect(
      links.listRelatedAssetLinks({ callerUserId: "user-stranger", assetId: fridge.id }),
    ).resolves.toEqual([]);
  });

  it("hides a link whose other side the caller cannot see, without hiding the rest", async () => {
    const { links, seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const fridge = await seedAsset({ scope: "household", householdId: household.id });
    const sharedFilter = await seedAsset({
      name: "Water filter",
      kind: "item",
      scope: "household",
      householdId: household.id,
    });
    const privateManualBinder = await seedAsset({ name: "Manual binder", kind: "item" });
    await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: sharedFilter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });
    await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: privateManualBinder.id,
      toAssetId: fridge.id,
      relation: "covers",
    });

    // The owner sees both; the member sees only the link between household assets —
    // the private binder's existence never leaks through the link row.
    const ownerView = await links.listRelatedAssetLinks({
      callerUserId: OWNER,
      assetId: fridge.id,
    });
    expect(ownerView).toHaveLength(2);

    const memberView = await links.listRelatedAssetLinks({
      callerUserId: MEMBER,
      assetId: fridge.id,
    });
    expect(memberView).toHaveLength(1);
    expect(memberView[0]?.otherAsset.id).toBe(sharedFilter.id);
    expect(memberView[0]?.owned).toBe(false);
  });
});

describe("suggestAssetLink (inferred, review-gated)", () => {
  async function seedGroundedPair(context: ReturnType<typeof setup>) {
    const fridge = await context.seedAsset();
    const filter = await context.seedAsset({ name: "Water filter", kind: "item" });
    const source = await seedSourceRecord(context.store, OWNER);
    return { fridge, filter, source };
  }

  it("persists a suggested link that only its owner sees, flagged pending", async () => {
    const context = setup();
    const { links, seedHousehold, auditKinds } = context;
    await seedHousehold();
    const { fridge, filter, source } = await seedGroundedPair(context);

    const link = await links.suggestAssetLink({
      ownerUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
      sourceRecordId: source.id,
    });
    expect(link.status).toBe("suggested");
    expect(link.sourceRecordId).toBe(source.id);
    await expect(auditKinds(filter.id)).resolves.toContain("link_suggested");

    const ownerView = await links.listRelatedAssetLinks({
      callerUserId: OWNER,
      assetId: filter.id,
    });
    expect(ownerView).toHaveLength(1);
    expect(ownerView[0]?.pending).toBe(true);
  });

  it("requires grounding and refuses restricted context unless directly requested", async () => {
    const context = setup();
    const { links } = context;
    const { fridge, filter } = await seedGroundedPair(context);
    const restricted = await context.store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "restricted note",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "restricted",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });

    await expect(
      links.suggestAssetLink({
        ownerUserId: OWNER,
        fromAssetId: filter.id,
        toAssetId: fridge.id,
        relation: "fits",
        sourceRecordId: "missing-source",
      }),
    ).rejects.toThrow(/grounded/);

    await expect(
      links.suggestAssetLink({
        ownerUserId: OWNER,
        fromAssetId: filter.id,
        toAssetId: fridge.id,
        relation: "fits",
        sourceRecordId: restricted.id,
      }),
    ).rejects.toThrow(/Restricted context/);

    const direct = await links.suggestAssetLink({
      ownerUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
      sourceRecordId: restricted.id,
      directlyRequested: true,
    });
    expect(direct.status).toBe("suggested");
  });

  it("returns the existing row instead of re-proposing: active stays active, dismissed stays quiet", async () => {
    const context = setup();
    const { links } = context;
    const { fridge, filter, source } = await seedGroundedPair(context);
    const active = await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });

    const reSuggested = await links.suggestAssetLink({
      ownerUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
      sourceRecordId: source.id,
    });
    expect(reSuggested.id).toBe(active.id);
    expect(reSuggested.status).toBe("active");

    // Dismissal is remembered: a dismissed link isn't re-proposed by inference.
    const suggested = await links.suggestAssetLink({
      ownerUserId: OWNER,
      fromAssetId: fridge.id,
      toAssetId: filter.id,
      relation: "uses",
      sourceRecordId: source.id,
    });
    await links.dismissSuggestedAssetLink({ actorUserId: OWNER, linkId: suggested.id });
    const reProposed = await links.suggestAssetLink({
      ownerUserId: OWNER,
      fromAssetId: fridge.id,
      toAssetId: filter.id,
      relation: "uses",
      sourceRecordId: source.id,
    });
    expect(reProposed.status).toBe("dismissed");
    await expect(
      links.listRelatedAssetLinks({ callerUserId: OWNER, assetId: fridge.id }),
    ).resolves.toHaveLength(1);
  });

  it("accepts a suggested link in place, making it visible to everyone who sees both sides", async () => {
    const context = setup();
    const { links, seedHousehold, auditKinds } = context;
    const household = await seedHousehold();
    const fridge = await context.seedAsset({ scope: "household", householdId: household.id });
    const filter = await context.seedAsset({
      name: "Water filter",
      kind: "item",
      scope: "household",
      householdId: household.id,
    });
    const { source } = await seedGroundedPair(context);

    const suggested = await links.suggestAssetLink({
      ownerUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
      sourceRecordId: source.id,
    });
    // A pending suggestion is owner-only — the member sees nothing yet.
    await expect(
      links.listRelatedAssetLinks({ callerUserId: MEMBER, assetId: fridge.id }),
    ).resolves.toEqual([]);

    const accepted = await links.acceptSuggestedAssetLink({
      actorUserId: OWNER,
      linkId: suggested.id,
    });
    expect(accepted.id).toBe(suggested.id);
    expect(accepted.status).toBe("active");
    await expect(auditKinds(filter.id)).resolves.toContain("link_promoted");

    const memberView = await links.listRelatedAssetLinks({
      callerUserId: MEMBER,
      assetId: fridge.id,
    });
    expect(memberView).toHaveLength(1);
    expect(memberView[0]?.pending).toBe(false);
  });

  it("dismisses a suggested link into a quiet husk and refuses to review it twice", async () => {
    const context = setup();
    const { links, auditKinds } = context;
    const { fridge, filter, source } = await seedGroundedPair(context);
    const suggested = await links.suggestAssetLink({
      ownerUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
      sourceRecordId: source.id,
    });

    await links.dismissSuggestedAssetLink({ actorUserId: OWNER, linkId: suggested.id });

    await expect(
      links.listRelatedAssetLinks({ callerUserId: OWNER, assetId: filter.id }),
    ).resolves.toEqual([]);
    await expect(auditKinds(filter.id)).resolves.toContain("link_dismissed");
    await expect(
      links.acceptSuggestedAssetLink({ actorUserId: OWNER, linkId: suggested.id }),
    ).rejects.toThrow(AssetValidationError);
  });
});

describe("cross-owner triples", () => {
  /** A household with two household-visible assets and a grounding source for OWNER. */
  async function seedHouseholdPair(context: ReturnType<typeof setup>) {
    const household = await context.seedHousehold();
    const fridge = await context.seedAsset({ scope: "household", householdId: household.id });
    const filter = await context.seedAsset({
      name: "Water filter",
      kind: "item",
      scope: "household",
      householdId: household.id,
    });
    const source = await seedSourceRecord(context.store, OWNER);
    return { fridge, filter, source };
  }

  it("a member's explicit add never resolves a co-member's pending suggestion", async () => {
    const context = setup();
    const { links, store } = context;
    const { fridge, filter, source } = await seedHouseholdPair(context);
    const suggestion = await links.suggestAssetLink({
      ownerUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
      sourceRecordId: source.id,
    });

    const membersLink = await links.addAssetLink({
      actorUserId: MEMBER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });

    // The member got their own active row; the owner's review is untouched.
    expect(membersLink.ownerUserId).toBe(MEMBER);
    expect(membersLink.id).not.toBe(suggestion.id);
    expect(membersLink.status).toBe("active");
    const ownersRow = await store.getAssetLink({ ownerUserId: OWNER, linkId: suggestion.id });
    expect(ownersRow?.status).toBe("suggested");
  });

  it("a member's explicit add never revives a co-member's dismissed husk", async () => {
    const context = setup();
    const { links, store } = context;
    const { fridge, filter, source } = await seedHouseholdPair(context);
    const suggestion = await links.suggestAssetLink({
      ownerUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
      sourceRecordId: source.id,
    });
    await links.dismissSuggestedAssetLink({ actorUserId: OWNER, linkId: suggestion.id });

    const membersLink = await links.addAssetLink({
      actorUserId: MEMBER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });

    // What the owner declined stays declined — the member's link is their own row.
    expect(membersLink.ownerUserId).toBe(MEMBER);
    expect(membersLink.status).toBe("active");
    const ownersHusk = await store.getAssetLink({ ownerUserId: OWNER, linkId: suggestion.id });
    expect(ownersHusk?.status).toBe("dismissed");
  });

  it("shows each caller one row per triple, preferring their own", async () => {
    const context = setup();
    const { links } = context;
    const { fridge, filter } = await seedHouseholdPair(context);
    await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });
    await links.addAssetLink({
      actorUserId: MEMBER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });

    const ownerView = await links.listRelatedAssetLinks({
      callerUserId: OWNER,
      assetId: filter.id,
    });
    expect(ownerView).toHaveLength(1);
    expect(ownerView[0]?.owned).toBe(true);

    const memberView = await links.listRelatedAssetLinks({
      callerUserId: MEMBER,
      assetId: filter.id,
    });
    expect(memberView).toHaveLength(1);
    expect(memberView[0]?.owned).toBe(true);
  });
});

describe("asset person links", () => {
  /** A washer with the caller's own person linked as its borrower. */
  async function seedBorrowedWasher(context: ReturnType<typeof setup>) {
    const washer = await context.seedAsset({ name: "Pressure washer", kind: "item" });
    const person = await seedPerson(context.store, OWNER);
    const link = await context.links.addAssetPersonLink({
      actorUserId: OWNER,
      assetId: washer.id,
      personId: person.id,
      relation: "borrowed",
    });
    return { washer, person, link };
  }

  it("links the caller's own person to a visible asset and names them in the read", async () => {
    const context = setup();
    const { links, auditKinds } = context;
    const { washer, person, link } = await seedBorrowedWasher(context);
    expect(link.ownerUserId).toBe(OWNER);
    await expect(auditKinds(washer.id)).resolves.toContain("person_link_added");

    const entries = await links.listAssetPersonLinks({ callerUserId: OWNER, assetId: washer.id });
    expect(entries).toEqual([
      {
        linkId: link.id,
        relation: "borrowed",
        person: { id: person.id, displayName: "Marcus" },
        // The moment the link was made — what Asset History retells (#202).
        createdAt: link.createdAt,
      },
    ]);
  });

  it("refuses a person the caller does not own — people are theirs alone", async () => {
    const { links, store, seedAsset } = setup();
    const washer = await seedAsset({ name: "Pressure washer", kind: "item" });
    const someoneElsesPerson = await seedPerson(store, "user-stranger");

    await expect(
      links.addAssetPersonLink({
        actorUserId: OWNER,
        assetId: washer.id,
        personId: someoneElsesPerson.id,
        relation: "uses",
      }),
    ).rejects.toThrow("Person not found.");
  });

  it("keeps person links caller-private: each member of a household sees only their own", async () => {
    const { links, store, seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const washer = await seedAsset({
      name: "Pressure washer",
      kind: "item",
      scope: "household",
      householdId: household.id,
    });
    const ownersPerson = await seedPerson(store, OWNER, "Marcus");
    const membersPerson = await seedPerson(store, MEMBER, "Priya");
    await links.addAssetPersonLink({
      actorUserId: OWNER,
      assetId: washer.id,
      personId: ownersPerson.id,
      relation: "borrowed",
    });
    await links.addAssetPersonLink({
      actorUserId: MEMBER,
      assetId: washer.id,
      personId: membersPerson.id,
      relation: "services",
    });

    const ownerEntries = await links.listAssetPersonLinks({
      callerUserId: OWNER,
      assetId: washer.id,
    });
    expect(ownerEntries.map((entry) => entry.person.displayName)).toEqual(["Marcus"]);

    const memberEntries = await links.listAssetPersonLinks({
      callerUserId: MEMBER,
      assetId: washer.id,
    });
    expect(memberEntries.map((entry) => entry.person.displayName)).toEqual(["Priya"]);
  });

  it("is idempotent per (asset, person, relation)", async () => {
    const context = setup();
    const { washer, person, link } = await seedBorrowedWasher(context);

    const second = await context.links.addAssetPersonLink({
      actorUserId: OWNER,
      assetId: washer.id,
      personId: person.id,
      relation: "borrowed",
    });
    expect(second.id).toBe(link.id);
  });

  it("removes only the caller's own link, and audits the removal", async () => {
    const context = setup();
    const { links, auditKinds } = context;
    const { washer, link } = await seedBorrowedWasher(context);

    await expect(
      links.removeAssetPersonLink({ actorUserId: MEMBER, linkId: link.id }),
    ).rejects.toThrow("Asset person link not found.");

    await links.removeAssetPersonLink({ actorUserId: OWNER, linkId: link.id });
    await expect(
      links.listAssetPersonLinks({ callerUserId: OWNER, assetId: washer.id }),
    ).resolves.toEqual([]);
    await expect(auditKinds(washer.id)).resolves.toContain("person_link_removed");
  });

  it("returns nothing for an asset the caller cannot see", async () => {
    const context = setup();
    const { washer } = await seedBorrowedWasher(context);

    await expect(
      context.links.listAssetPersonLinks({ callerUserId: "user-stranger", assetId: washer.id }),
    ).resolves.toEqual([]);
  });
});

describe("removeAssetLink", () => {
  it("removes the owner's link and audits the removal", async () => {
    const { links, seedAsset, auditKinds } = setup();
    const fridge = await seedAsset();
    const filter = await seedAsset({ name: "Water filter", kind: "item" });
    const link = await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });

    await links.removeAssetLink({ actorUserId: OWNER, linkId: link.id });

    await expect(
      links.listRelatedAssetLinks({ callerUserId: OWNER, assetId: filter.id }),
    ).resolves.toEqual([]);
    await expect(auditKinds(filter.id)).resolves.toContain("link_removed");
  });

  it("is owner-only: a member who can see both assets cannot remove the owner's link", async () => {
    const { links, seedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const fridge = await seedAsset({ scope: "household", householdId: household.id });
    const filter = await seedAsset({
      name: "Water filter",
      kind: "item",
      scope: "household",
      householdId: household.id,
    });
    const link = await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
    });

    await expect(links.removeAssetLink({ actorUserId: MEMBER, linkId: link.id })).rejects.toThrow(
      "Asset link not found.",
    );
  });
});
