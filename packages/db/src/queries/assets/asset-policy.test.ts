import {
  type AssetMemory,
  AssetValidationError,
  type HouseholdMembership,
  MAX_ASSET_ACTION_PROPOSALS,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  createInMemoryAssetSearchAuthorityStore,
  createInMemoryAssetSearchStore,
} from "../asset-search/in-memory-store";
import { createAssetSearch } from "../asset-search/queries";
import { createAssetSnapshot } from "../asset-snapshots/builder";
import { createInMemoryAssetSnapshotStore } from "../asset-snapshots/in-memory-store";
import type { AssetSnapshotContextStore } from "../asset-snapshots/types";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { createSuggestedGeneralActionReview } from "../general-actions/review";
import type { EmbeddingAdapter } from "../semantic-retrieval/types";
import { createAssetActionProposals } from "./action-proposals";
import { seedOwnerMemberHousehold, seedSourceRecord } from "./asset-test-fixtures";
import { createInMemoryAssetActionLinkStore } from "./in-memory-action-link-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAssetContextLinks } from "./links";
import { createAssetReview } from "./review";

/**
 * The Phase 6 security boundary, stated once and in one place (#196, #205).
 *
 * Every rule here is enforced somewhere in a module's own suite. What this file adds is
 * the thing no module test can: it composes the *whole* Asset seam into one world — a
 * household refrigerator with reviewed details, a co-member's private receipt hanging
 * under it, an unreviewed suggestion, an inferred link, a dismissed reminder — and then
 * asks the same question of every read surface a person or Eve can reach: the profile,
 * the memory list, the evidence list, the related links, Asset Search, the snapshot, and
 * the proposal pass. A boundary that holds in `review.ts` but leaks through `search.ts`
 * is not a boundary, and only a composed world can catch that.
 *
 * Deterministic on purpose: no model, no database, no clock. These are the rules that
 * must hold whatever the assistant says, so the Eve evals can be about *behavior* while
 * this file is about *access*.
 */

const OWNER = "owner-user";
const MEMBER = "member-user";
const OTHER_MEMBER = "other-member-user";
const OUTSIDER = "outsider-user";

/** A fixed instant, so a proposal's timing is a fact rather than a race with the clock. */
const NOW = new Date(2026, 6, 13, 9, 30);

/** The semantic tier is not the boundary — exact recall is. Failing it open proves that. */
const coldIndex: EmbeddingAdapter = {
  embedText() {
    return Promise.reject(new Error("no embedding index in policy tests"));
  },
};

async function setupWorld() {
  const store = {
    ...createInMemoryAssetActionLinkStore(),
    ...createInMemoryAssetSnapshotStore(),
  } satisfies AssetSnapshotContextStore;

  const lifecycle = createAssetLifecycle(store);
  const review = createAssetReview(store);
  const links = createAssetContextLinks(store);
  const proposals = createAssetActionProposals(store);
  const snapshots = createAssetSnapshot(store);
  const actionLifecycle = createGeneralActionLifecycle(store);
  const actionReview = createSuggestedGeneralActionReview(store);

  const household = await seedOwnerMemberHousehold(store, OWNER, MEMBER);
  const sourceRecord = await seedSourceRecord(store, OWNER);

  // The household refrigerator: shared with the whole household, and the anchor every
  // child-scope question in this file is asked about.
  const fridge = await lifecycle.createAsset({
    ownerUserId: OWNER,
    name: "Kitchen refrigerator",
    kind: "appliance",
    scope: "household",
    householdId: household.id,
  });
  // The owner's own private asset: nothing about it is any co-member's business.
  const notebook = await lifecycle.createAsset({
    ownerUserId: OWNER,
    name: "Work laptop",
    kind: "item",
  });

  // A reviewed, household-visible fact — the kind of exact value an answer lives on.
  const filterSize = await review.createActiveAssetMemory({
    ownerUserId: OWNER,
    assetId: fridge.id,
    label: "Filter size",
    value: { type: "text", text: "EDR1RXD1" },
    scope: "household",
  });
  // The co-member's private detail, hanging under the *household* asset.
  const memberQuote = await review.createActiveAssetMemory({
    ownerUserId: MEMBER,
    assetId: fridge.id,
    label: "Compressor repair quote",
    value: { type: "amount", amount: 840, currency: "USD" },
    scope: "private",
  });
  const householdReceipt = await review.addAssetEvidence({
    ownerUserId: OWNER,
    assetId: fridge.id,
    kind: "receipt",
    label: "Appliance store receipt",
    capturedText: "Kitchen refrigerator, paid in full.",
    scope: "household",
  });
  const memberReceipt = await review.addAssetEvidence({
    ownerUserId: MEMBER,
    assetId: fridge.id,
    kind: "receipt",
    label: "Compressor repair receipt",
    capturedText: "Compressor swap, paid privately.",
    scope: "private",
  });

  // An inferred detail still waiting in review: not a fact until the owner says so.
  //
  // It carries a *date* deliberately. A dated detail is the only kind that can propose a
  // reminder, so this suggestion is the world's one proposal candidate — which is what makes
  // the review gate below testable at all. Give it a text value (a filter size, say) and the
  // proposal pass would be empty whatever the gate did, and the test would prove nothing.
  const suggestedGroup = await review.suggestAssetMemories({
    ownerUserId: OWNER,
    assetId: fridge.id,
    sourceRecordId: sourceRecord.id,
    memories: [
      {
        label: "Ice maker filter due",
        value: { type: "date", date: "2027-01-10" },
        scope: "household",
      },
    ],
  });
  const suggestedMemory = suggestedGroup.memories[0] as AssetMemory;

  const memberships = await store.listHouseholdMemberships({
    householdId: household.id,
    status: "active",
  });

  /**
   * Asset Search over the very rows the write seam just produced. Search keeps its own
   * seeded store, so wiring the real rows into it is what makes the scope claims below
   * one claim about one world rather than two claims about two.
   */
  function searchAs(seed: { memberships?: HouseholdMembership[] } = {}) {
    return createAssetSearch(
      createInMemoryAssetSearchStore({
        assets: [fridge, notebook],
        memories: [filterSize, memberQuote, suggestedMemory],
        evidence: [householdReceipt, memberReceipt],
        householdMemberships: seed.memberships ?? memberships,
      }),
      createInMemoryAssetSearchAuthorityStore({
        householdMemberships: seed.memberships ?? memberships,
      }),
      coldIndex,
      { model: "fake", version: "v1" },
    );
  }

  return {
    store,
    lifecycle,
    review,
    links,
    proposals,
    snapshots,
    actionLifecycle,
    actionReview,
    household,
    sourceRecord,
    fridge,
    notebook,
    filterSize,
    memberQuote,
    householdReceipt,
    memberReceipt,
    suggestedMemory,
    searchAs,
  };
}

describe("Phase 6 policy — Asset Visibility", () => {
  it("shows a household asset to its members and a private one to nobody else", async () => {
    const { lifecycle, fridge, notebook } = await setupWorld();

    expect((await lifecycle.getAsset({ callerUserId: MEMBER, assetId: fridge.id }))?.name).toBe(
      "Kitchen refrigerator",
    );
    expect(await lifecycle.getAsset({ callerUserId: MEMBER, assetId: notebook.id })).toBeNull();
    expect(await lifecycle.getAsset({ callerUserId: OUTSIDER, assetId: fridge.id })).toBeNull();

    expect(
      (await lifecycle.listAssets({ callerUserId: MEMBER })).map((asset) => asset.name),
    ).toEqual(["Kitchen refrigerator"]);
    expect(await lifecycle.listAssets({ callerUserId: OUTSIDER })).toEqual([]);
  });

  it("denies an asset the caller cannot see exactly as it denies one that does not exist", async () => {
    const { lifecycle, notebook } = await setupWorld();

    // Indistinguishable by construction (ADR 0153): a denial that looks different from a
    // miss is a disclosure that the record exists.
    expect(await lifecycle.getAsset({ callerUserId: MEMBER, assetId: notebook.id })).toBe(
      await lifecycle.getAsset({
        callerUserId: MEMBER,
        assetId: "00000000-0000-0000-0000-000000000000",
      }),
    );
  });

  it("keeps a Suggested Asset out of every scope-visible read until it is accepted", async () => {
    const { lifecycle, review, sourceRecord } = await setupWorld();

    const { asset } = await review.suggestAsset({
      ownerUserId: OWNER,
      name: "Garage dehumidifier",
      kind: "appliance",
      sourceRecordId: sourceRecord.id,
    });

    // Its own owner does not see it on the Assets surface — a proposal is a review item,
    // not an asset — and a co-member cannot see it at all.
    expect(
      (await lifecycle.listAssets({ callerUserId: OWNER })).map((row) => row.id),
    ).not.toContain(asset.id);
    expect(await lifecycle.getAsset({ callerUserId: MEMBER, assetId: asset.id })).toBeNull();
  });
});

describe("Phase 6 policy — the child-scope ceiling", () => {
  it("refuses a household detail under a private asset — a child may narrow, never widen", async () => {
    const { review, notebook } = await setupWorld();

    await expect(
      review.createActiveAssetMemory({
        ownerUserId: OWNER,
        assetId: notebook.id,
        label: "Serial number",
        value: { type: "text", text: "C02X1234" },
        scope: "household",
      }),
    ).rejects.toThrow(AssetValidationError);

    await expect(
      review.addAssetEvidence({
        ownerUserId: OWNER,
        assetId: notebook.id,
        kind: "receipt",
        label: "Laptop receipt",
        capturedText: "Paid in full.",
        scope: "household",
      }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("hides a co-member's private detail hanging under the shared asset", async () => {
    const { review, fridge, memberQuote, memberReceipt } = await setupWorld();

    // The owner of the household asset still cannot see what a member kept private on it.
    const ownerMemories = await review.listAssetMemories({
      callerUserId: OWNER,
      assetId: fridge.id,
    });
    expect(ownerMemories.map((memory) => memory.id)).not.toContain(memberQuote.id);

    const ownerEvidence = await review.listAssetEvidence({
      callerUserId: OWNER,
      assetId: fridge.id,
    });
    expect(ownerEvidence.map((item) => item.id)).not.toContain(memberReceipt.id);

    // And the member does see their own, on the same asset — the ceiling narrows the
    // record, it does not hide the asset.
    const memberMemories = await review.listAssetMemories({
      callerUserId: MEMBER,
      assetId: fridge.id,
    });
    expect(memberMemories.map((memory) => memory.label).sort()).toEqual([
      "Compressor repair quote",
      "Filter size",
    ]);
  });

  it("lets memories and evidence use a selected audience without widening to the household", async () => {
    const { store, lifecycle, review, household } = await setupWorld();
    await store.createHouseholdMembership({
      householdId: household.id,
      userId: OTHER_MEMBER,
      invitedByUserId: OWNER,
      role: "member",
      status: "active",
      invitedAt: NOW,
      acceptedAt: NOW,
      removedAt: null,
    });
    const sharedAsset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Selected refrigerator",
      kind: "appliance",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [MEMBER],
    });

    const memory = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: sharedAsset.id,
      label: "Filter size",
      value: { type: "text", text: "EDR1RXD1" },
      scope: "shared",
      selectedUserIds: [MEMBER],
    });
    const evidence = await review.addAssetEvidence({
      ownerUserId: OWNER,
      assetId: sharedAsset.id,
      kind: "receipt",
      label: "Filter receipt",
      capturedText: "EDR1RXD1",
    });

    expect(memory.scope).toBe("shared");
    expect(evidence.scope).toBe("shared");
    expect(
      (await review.listAssetMemories({ callerUserId: MEMBER, assetId: sharedAsset.id })).map(
        (record) => record.id,
      ),
    ).toContain(memory.id);
    expect(
      (await review.listAssetEvidence({ callerUserId: MEMBER, assetId: sharedAsset.id })).map(
        (record) => record.id,
      ),
    ).toContain(evidence.id);
    expect(
      await review.listAssetMemories({ callerUserId: OTHER_MEMBER, assetId: sharedAsset.id }),
    ).toEqual([]);
    expect(
      await review.listAssetEvidence({ callerUserId: OTHER_MEMBER, assetId: sharedAsset.id }),
    ).toEqual([]);
  });

  it("supports a selected child audience beneath a household asset", async () => {
    const { review, fridge } = await setupWorld();
    const memory = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: fridge.id,
      label: "Private household detail",
      notes: "Visible to one selected member.",
      scope: "shared",
      selectedUserIds: [MEMBER],
    });

    expect(memory.scope).toBe("shared");
    expect(
      (await review.listAssetMemories({ callerUserId: MEMBER, assetId: fridge.id })).map(
        (record) => record.id,
      ),
    ).toContain(memory.id);
  });

  it("keeps a private child record out of Asset Search for everyone but its owner", async () => {
    const { searchAs, memberQuote } = await setupWorld();
    const search = searchAs();

    const ownerHits = await search.searchAssets({ ownerUserId: OWNER, query: "compressor repair" });
    expect(ownerHits.map((hit) => hit.recordId)).not.toContain(memberQuote.id);

    const memberHits = await search.searchAssets({
      ownerUserId: MEMBER,
      query: "compressor repair",
    });
    expect(memberHits.map((hit) => hit.recordId)).toContain(memberQuote.id);
  });

  it("gives every visible record a visibility label, so an answer can say how far it reaches", async () => {
    const { searchAs } = await setupWorld();

    const hits = await searchAs().searchAssets({ ownerUserId: OWNER, query: "EDR1RXD1" });

    expect(hits.map((hit) => [hit.label, hit.visibilityLabel])).toContainEqual([
      "Filter size",
      "Whole household",
    ]);
  });
});

describe("Phase 6 policy — review-gated writes", () => {
  it("never lets an unreviewed Asset Memory read as a fact", async () => {
    const { review, snapshots, searchAs, fridge, suggestedMemory } = await setupWorld();
    const memoryId = suggestedMemory.id;

    // Not on the profile…
    const visible = await review.listAssetMemories({ callerUserId: OWNER, assetId: fridge.id });
    expect(visible.map((memory) => memory.id)).not.toContain(memoryId);

    // …not in the snapshot's grounding records…
    const { context } = await snapshots.getAssetSnapshot({
      callerUserId: OWNER,
      assetId: fridge.id,
    });
    expect(context.memories.map((memory) => memory.id)).not.toContain(memoryId);

    // …and not in the search Eve answers from, whose review-gated flag Eve cannot set.
    const search = searchAs();
    const answers = await search.searchAssets({ ownerUserId: OWNER, query: "ice maker filter" });
    expect(answers.map((hit) => hit.recordId)).not.toContain(memoryId);

    // It exists only where review happens: owner-only, and labeled a suggestion there.
    const reviewContext = await search.searchAssets({
      ownerUserId: OWNER,
      query: "ice maker filter",
      includeReviewGated: true,
    });
    expect(reviewContext.find((hit) => hit.recordId === memoryId)?.trustLevel).toBe(
      "suggested_asset_fact",
    );

    // Even in review context, a co-member never sees another person's proposal.
    const memberReview = await search.searchAssets({
      ownerUserId: MEMBER,
      query: "ice maker filter",
      includeReviewGated: true,
    });
    expect(memberReview.map((hit) => hit.recordId)).not.toContain(memoryId);
  });

  it("keeps a dismissed suggestion dismissed — a rejection is not a draft", async () => {
    const { review, fridge, suggestedMemory } = await setupWorld();
    const memoryId = suggestedMemory.id;

    await review.dismissSuggestedAssetMemory({ actorUserId: OWNER, memoryId });

    const visible = await review.listAssetMemories({ callerUserId: OWNER, assetId: fridge.id });
    expect(visible.map((memory) => memory.id)).not.toContain(memoryId);

    await expect(
      review.acceptSuggestedAssetMemory({ actorUserId: OWNER, memoryId }),
    ).rejects.toThrow(/set aside/i);
  });

  it("lets only the owner review their own proposals", async () => {
    const { review, suggestedMemory } = await setupWorld();

    await expect(
      review.acceptSuggestedAssetMemory({
        actorUserId: MEMBER,
        memoryId: suggestedMemory.id,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("Phase 6 policy — inferred related links", () => {
  it("keeps an inferred Related Asset Link owner-only and marked pending until review", async () => {
    const { links, lifecycle, household, fridge, sourceRecord } = await setupWorld();

    const filter = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator water filter",
      kind: "item",
      scope: "household",
      householdId: household.id,
    });

    const suggested = await links.suggestAssetLink({
      ownerUserId: OWNER,
      fromAssetId: filter.id,
      toAssetId: fridge.id,
      relation: "fits",
      sourceRecordId: sourceRecord.id,
    });

    // The owner sees their own proposal — flagged `pending`, so no surface can render it
    // as an established relation — and the co-member does not see it at all. Tendnote
    // does not build the asset graph behind anyone's back.
    const ownerView = await links.listRelatedAssetLinks({
      callerUserId: OWNER,
      assetId: fridge.id,
    });
    expect(ownerView.map((link) => [link.relation, link.pending])).toEqual([["fits", true]]);
    expect(await links.listRelatedAssetLinks({ callerUserId: MEMBER, assetId: fridge.id })).toEqual(
      [],
    );

    await links.acceptSuggestedAssetLink({ actorUserId: OWNER, linkId: suggested.id });

    const accepted = await links.listRelatedAssetLinks({
      callerUserId: MEMBER,
      assetId: fridge.id,
    });
    expect(accepted.map((link) => [link.relation, link.direction, link.pending])).toEqual([
      ["fits", "incoming", false],
    ]);
  });

  it("never widens visibility through a link — a link is context, not access", async () => {
    const { links, fridge, notebook } = await setupWorld();

    await links.addAssetLink({
      actorUserId: OWNER,
      fromAssetId: notebook.id,
      toAssetId: fridge.id,
      relation: "stored_with",
    });

    // The member can see the fridge. They still cannot see the private laptop it is
    // linked to, so the link simply is not there for them.
    expect(await links.listRelatedAssetLinks({ callerUserId: MEMBER, assetId: fridge.id })).toEqual(
      [],
    );
    expect(
      (await links.listRelatedAssetLinks({ callerUserId: OWNER, assetId: fridge.id })).map(
        (link) => link.otherAsset.name,
      ),
    ).toEqual(["Work laptop"]);
  });
});

describe("Phase 6 policy — proactive surfacing", () => {
  it("proposes an asset reminder as a review item, never as an active action", async () => {
    const { review, proposals, actionLifecycle, fridge } = await setupWorld();

    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: fridge.id,
      label: "Warranty expires",
      value: { type: "date", date: "2027-03-14" },
      scope: "household",
    });

    const { proposed } = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: fridge.id,
      now: NOW,
      source: "assistant",
    });

    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.action.status).toBe("suggested");
    // The ledger — and therefore Today, the daily summary, and every proactive surface,
    // which all read active actions — stays empty until the owner accepts.
    expect(await actionLifecycle.listActiveGeneralActions({ ownerUserId: OWNER })).toEqual([]);
  });

  it("never re-proposes a detail whose proposal the owner dismissed", async () => {
    const { review, proposals, actionReview, fridge } = await setupWorld();

    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: fridge.id,
      label: "Replacement interval",
      value: { type: "interval", interval: 6, unit: "month" },
      scope: "household",
    });

    const first = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: fridge.id,
      now: NOW,
    });
    expect(first.proposed).toHaveLength(1);

    await actionReview.dismissSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: first.proposed[0]?.action.id as string,
    });

    // The nag rule: asking again — however it is asked, and however often — must not put
    // back what the owner just turned down.
    const again = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: fridge.id,
      now: NOW,
    });
    expect(again.proposed).toEqual([]);
    expect(again.alreadySpokenFor).toBe(1);
  });

  it("proposes nothing from a detail still waiting in review", async () => {
    const { review, proposals, fridge, suggestedMemory } = await setupWorld();

    // The fridge's only proposal candidate is the *suggested* ice-maker date — a future date,
    // on this asset, of exactly the shape that proposes. The one and only thing standing
    // between it and a review item is its `suggested` status: accept it below and the same
    // pass proposes. So an empty pass here can only mean the review gate held.
    const { proposed } = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: fridge.id,
      now: NOW,
    });

    expect(proposed).toEqual([]);

    // The control. A suggestion must not cascade into a second review item downstream of its
    // own gate — but once the owner says the fact is true, it may argue for one.
    await review.acceptSuggestedAssetMemory({ actorUserId: OWNER, memoryId: suggestedMemory.id });

    const afterReview = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: fridge.id,
      now: NOW,
    });

    expect(afterReview.proposed.map((proposal) => proposal.assetMemoryId)).toEqual([
      suggestedMemory.id,
    ]);
  });

  it("caps a single pass, so one asset can never arrive as a wall of review items", async () => {
    const { review, proposals, fridge } = await setupWorld();

    for (const month of ["01", "02", "03", "04"]) {
      await review.createActiveAssetMemory({
        ownerUserId: OWNER,
        assetId: fridge.id,
        label: `Service due ${month}`,
        value: { type: "date", date: `2027-${month}-05` },
        scope: "household",
      });
    }

    const { proposed } = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: fridge.id,
      now: NOW,
    });

    expect(proposed).toHaveLength(MAX_ASSET_ACTION_PROPOSALS);
  });

  it("keeps a private detail's reminder private, even under a household asset", async () => {
    const { review, proposals, fridge } = await setupWorld();

    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: fridge.id,
      label: "Warranty expires",
      value: { type: "date", date: "2027-03-14" },
      scope: "private",
    });

    const { proposed } = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: fridge.id,
      now: NOW,
    });

    // The proposal quotes the memory in its notes, so it inherits the *memory's* audience,
    // not the asset's — otherwise a private fact would leak through the reminder it caused.
    expect(proposed[0]?.action.scope).toBe("private");
    expect(proposed[0]?.action.householdId).toBeNull();
  });

  it("refuses to propose against an archived asset — a sold thing does not nag", async () => {
    const { lifecycle, review, proposals } = await setupWorld();

    const car = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Old car",
      kind: "vehicle",
    });
    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: car.id,
      label: "Oil change interval",
      value: { type: "interval", interval: 6, unit: "month" },
    });
    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: car.id });

    await expect(
      proposals.proposeAssetMemoryActions({ actorUserId: OWNER, assetId: car.id, now: NOW }),
    ).rejects.toThrow(AssetValidationError);
  });
});

describe("Phase 6 policy — snapshots are a cache, records are the truth", () => {
  it("returns the live records with the snapshot, and cites only rows the caller may see", async () => {
    const { snapshots, fridge, filterSize, memberQuote, memberReceipt } = await setupWorld();

    const { status, snapshot, context } = await snapshots.getAssetSnapshot({
      callerUserId: OWNER,
      assetId: fridge.id,
    });

    expect(status).toBe("rebuilt");
    expect(context.memories.map((memory) => memory.id)).toEqual([filterSize.id]);

    // The citations are the grounding contract: record ids, owned by the builder, never
    // by the generator — and never naming a record this caller could not open.
    expect(snapshot?.supportingReferences.assetMemoryIds).toEqual([filterSize.id]);
    expect(snapshot?.supportingReferences.assetMemoryIds).not.toContain(memberQuote.id);
    expect(snapshot?.supportingReferences.assetEvidenceIds).not.toContain(memberReceipt.id);
  });

  it("rebuilds a snapshot whose records changed — a stale summary is never served", async () => {
    const { store, snapshots, review, fridge } = await setupWorld();

    const first = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: fridge.id });
    expect(first.snapshot?.summary).toContain("EDR1RXD1");

    // Correcting the fact is all it takes: the fingerprint is computed from the records,
    // so no cache-invalidation event can be forgotten and no old prose can outlive them.
    await store.updateAssetMemory({
      ownerUserId: OWNER,
      memoryId: (await review.listAssetMemories({ callerUserId: OWNER, assetId: fridge.id }))[0]
        ?.id as string,
      patch: { value: { type: "text", text: "XWFE" } },
    });

    const second = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: fridge.id });
    expect(second.status).toBe("rebuilt");
    expect(second.snapshot?.summary).toContain("XWFE");
    expect(second.snapshot?.summary).not.toContain("EDR1RXD1");
  });

  it("degrades to the records alone when generation fails", async () => {
    const store = {
      ...createInMemoryAssetActionLinkStore(),
      ...createInMemoryAssetSnapshotStore(),
    } satisfies AssetSnapshotContextStore;
    const lifecycle = createAssetLifecycle(store);
    const review = createAssetReview(store);
    const snapshots = createAssetSnapshot(store, {
      generator: () => Promise.reject(new Error("generator down")),
    });

    const asset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Kitchen refrigerator",
      kind: "appliance",
    });
    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Filter size",
      value: { type: "text", text: "EDR1RXD1" },
    });

    const { status, context } = await snapshots.getAssetSnapshot({
      callerUserId: OWNER,
      assetId: asset.id,
    });

    // The prose is gone; the truth is not. That is what makes the cache safe to lose.
    expect(status).toBe("fallback");
    expect(context.memories.map((memory) => memory.label)).toEqual(["Filter size"]);
  });
});
