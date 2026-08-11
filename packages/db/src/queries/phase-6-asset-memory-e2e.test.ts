import {
  type Asset,
  type AssetEvidence,
  type AssetMemory,
  classifyActionSurfacing,
  type HouseholdMembership,
  isDurableAssetStatus,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  createInMemoryAssetSearchAuthorityStore,
  createInMemoryAssetSearchStore,
} from "./asset-search/in-memory-store";
import { createAssetSearch } from "./asset-search/queries";
import { createAssetSnapshot } from "./asset-snapshots/builder";
import { createInMemoryAssetSnapshotStore } from "./asset-snapshots/in-memory-store";
import type { AssetSnapshotContextStore } from "./asset-snapshots/types";
import { createAssetActionLinks } from "./assets/action-links";
import { createAssetActionProposals } from "./assets/action-proposals";
import { seedOwnerMemberHousehold } from "./assets/asset-test-fixtures";
import { createAssetHistory } from "./assets/history";
import { createInMemoryAssetActionLinkStore } from "./assets/in-memory-action-link-store";
import { createAssetLifecycle } from "./assets/lifecycle";
import { createAssetContextLinks } from "./assets/links";
import { createAssetReview } from "./assets/review";
import { createGeneralActionLifecycle } from "./general-actions/lifecycle";
import { createSuggestedGeneralActionReview } from "./general-actions/review";
import type { EmbeddingAdapter } from "./semantic-retrieval/types";

/**
 * Phase 6 Asset Memory — the proof scenario, composed (#196 story 65, #205).
 *
 * The per-slice suites (#197–#204) each prove their own seam, and `asset-policy.test.ts` proves
 * the privacy boundary holds across every read surface at once. What neither can prove is the
 * *join*: that a thing which starts life as a passing label on a Phase 5 to-do actually arrives,
 * intact, as a fact Eve can answer with. Every hand-off in that chain is a place where a slice
 * can be individually correct and the product still broken — an accepted memory that was never
 * embedded is not searchable; a snapshot that cites nothing is prose; a promoted hint whose link
 * never moves leaves the action pointing at a dismissed husk.
 *
 * So this file walks the whole path through the REAL seams, no mocks of anything under test:
 *
 *   asset hint on an Action → promotion → Suggested Asset + Review Group → inferred details and
 *   captured evidence → edit-before-accept → durable Asset Memories → embedded and searchable →
 *   snapshot built and CITING those records → a dated detail proposing a reminder → accepted onto
 *   the ledger and the Asset's profile → the whole thing visible to the household, while a
 *   co-member's private detail on the same Asset stays theirs alone.
 *
 * It is the Phase 6 analogue of `phase-5-general-actions-e2e.test.ts`, and it is deliberately
 * deterministic: no model, no database, no clock.
 */

const OWNER = "owner-1";
const MEMBER = "member-1";

/** A fixed instant, so a proposal's timing is a fact rather than a race with the clock. */
const NOW = new Date(2026, 6, 13, 9, 30);

/** The value the world hangs on. Typed exactly once, and never typed again anywhere else. */
const FILTER_MODEL = "EDR1RXD1";

/**
 * A themed embedding adapter, so the semantic tier is predictable: appliance/filter talk lands on
 * one axis and everything else is orthogonal. It stands in for the model, not for the pipeline —
 * the embed-on-write scheduling it feeds is the real thing.
 */
const themedAdapter: EmbeddingAdapter = {
  async embedText(input) {
    return { vector: themeVector(input.text), model: input.model, version: input.version };
  },
};

function themeVector(text: string): number[] {
  return /fridge|refrigerator|filter|appliance|kitchen/i.test(text) ? [1, 0] : [0, 1];
}

async function seedJourney() {
  const store = {
    ...createInMemoryAssetActionLinkStore(),
    ...createInMemoryAssetSnapshotStore(),
  } satisfies AssetSnapshotContextStore;

  // Every durable asset write enqueues an embedding job on the shared pipeline (#204). Capturing
  // the schedule here is how the walk proves "accepted" and "findable" are the same event.
  const embedded: Array<{ recordKind: string; recordId: string }> = [];
  const scheduleAssetEmbedding = async (job: { recordKind: string; recordId: string }) => {
    embedded.push({ recordKind: job.recordKind, recordId: job.recordId });
  };

  const assets = createAssetLifecycle(store, { scheduleAssetEmbedding });
  const review = createAssetReview(store, { scheduleAssetEmbedding });
  const bridge = createAssetActionLinks(store);
  const proposals = createAssetActionProposals(store);
  const links = createAssetContextLinks(store);
  const history = createAssetHistory(store);
  const snapshots = createAssetSnapshot(store);
  const actions = createGeneralActionLifecycle(store);
  const actionReview = createSuggestedGeneralActionReview(store);

  const household = await seedOwnerMemberHousehold(store, OWNER, MEMBER);

  // What the user actually said, once. Every inference below is grounded in it (ADR 0151).
  const source = await store.createSourceRecord({
    ownerUserId: OWNER,
    sourceType: "manual",
    content: `Fridge takes an ${FILTER_MODEL} filter, swap it every 6 months. Receipt is in the drawer.`,
    rawContent: null,
    retentionPolicy: "retain",
    status: "active",
  });

  return {
    store,
    assets,
    review,
    bridge,
    proposals,
    links,
    history,
    snapshots,
    actions,
    actionReview,
    household,
    source,
    embedded,
  };
}

/** Asset Search over the rows the write seams actually produced — never a hand-built twin. */
function searchOver(input: {
  assets: Asset[];
  memories: AssetMemory[];
  evidence: AssetEvidence[];
  memberships: HouseholdMembership[];
}) {
  return createAssetSearch(
    createInMemoryAssetSearchStore({
      assets: input.assets,
      memories: input.memories,
      evidence: input.evidence,
      householdMemberships: input.memberships,
    }),
    createInMemoryAssetSearchAuthorityStore({ householdMemberships: input.memberships }),
    themedAdapter,
    { model: "fake", version: "v1" },
  );
}

describe("Phase 6 proof scenario — the refrigerator water filter, from asset hint to answer", () => {
  it("walks hint → review → accept → durable memory → searchable → snapshot citation → reminder → household scope", async () => {
    const world = await seedJourney();
    const { store, assets, review, bridge, proposals, snapshots, actions, actionReview } = world;

    // 1) THE PHASE 5 HINT. A household to-do carrying nothing but a label: Phase 5 could remember
    //    that the action was *about* a filter, and nothing else about the filter itself (ADR 0156).
    const action = await actions.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      recurrence: { interval: 6, unit: "month" },
      dueAt: NOW,
      scope: "household",
      householdId: world.household.id,
      assetHints: [{ label: "refrigerator water filter" }],
      sourceRecordId: world.source.id,
    });

    // 2) PROMOTION. The hint becomes a *proposal*, never a record: a Suggested Asset in an Asset
    //    Review Group, with the duplicate prompt computed at read time.
    const promoted = await bridge.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: "refrigerator water filter",
      kind: "appliance",
    });
    // 3) THE PROPOSAL.
    expect(promoted.outcome).toBe("pending_review");
    const group = promoted.outcome === "pending_review" ? promoted.group : (undefined as never);
    expect(group.asset.status).toBe("suggested");
    expect(isDurableAssetStatus(group.asset.status)).toBe(false);

    // 4) PRE-ACCEPT INVARIANTS. The proposal is nobody's asset yet, and the gate is not a matter
    //    of phrasing: the Assets surface does not show it, a co-member cannot see it at all, and
    //    the snapshot — the thing an assistant would love to summarize — has no asset to
    //    summarize. Nor is anything embedded: a proposal is not retrievable context.
    expect(await assets.listAssets({ callerUserId: OWNER })).toEqual([]);
    expect(await assets.getAsset({ callerUserId: MEMBER, assetId: group.asset.id })).toBeNull();
    // The co-member's snapshot read of the proposal falls back to nothing at all — an asset they
    // cannot see and one that does not exist are the same answer (ADR 0153).
    const memberSnapshot = await snapshots.getAssetSnapshot({
      callerUserId: MEMBER,
      assetId: group.asset.id,
    });
    expect(memberSnapshot.status).toBe("fallback");
    expect(memberSnapshot.context.asset).toBeNull();

    // The owner may look at their own pending proposal, and there is nothing in it to summarize:
    // a suggestion is not a fact, so it grounds no prose and the snapshot cites no records.
    const beforeAccept = await snapshots.getAssetSnapshot({
      callerUserId: OWNER,
      assetId: group.asset.id,
    });
    expect(beforeAccept.context.memories).toEqual([]);
    expect(beforeAccept.snapshot?.supportingReferences.assetMemoryIds).toEqual([]);

    // And nothing has been embedded: a proposal is not retrievable context.
    expect(world.embedded).toEqual([]);

    // 5) THE FIRST REVIEW. The owner accepts the thing itself. Only now does an Asset exist.
    const acceptedAsset = await review.acceptAssetReviewGroup({
      actorUserId: OWNER,
      groupId: group.group.id,
    });
    expect(acceptedAsset.asset.status).toBe("active");
    const asset = acceptedAsset.asset;

    // 6) INFERENCE. The details Tendnote *thinks* it heard, and the receipt that grounds them,
    //    arrive as a second review group on the now-durable Asset — and the model number arrives
    //    subtly wrong, as it does in life.
    const details = await review.suggestAssetMemories({
      ownerUserId: OWNER,
      assetId: asset.id,
      sourceRecordId: world.source.id,
      memories: [
        { label: "Filter size", value: { type: "text", text: "EDR1RXD" }, scope: "household" },
        {
          label: "Replacement interval",
          value: { type: "interval", interval: 6, unit: "month" },
          scope: "household",
        },
      ],
    });
    const receipt = await review.addAssetEvidence({
      ownerUserId: OWNER,
      reviewGroupId: details.group.id,
      kind: "receipt",
      label: "Appliance store receipt",
      capturedText: "Kitchen refrigerator — paid in full.",
      money: { amount: 1899, currency: "USD" },
      scope: "household",
    });

    // A suggested detail is not a fact: it is on nobody's profile, and a co-member — who can now
    // see the Asset — cannot see what is still being proposed about it.
    expect(await review.listAssetMemories({ callerUserId: OWNER, assetId: asset.id })).toEqual([]);
    expect(await review.listAssetMemories({ callerUserId: MEMBER, assetId: asset.id })).toEqual([]);

    // 7) EDIT BEFORE ACCEPT. The owner fixes the misheard part number *before* accepting it —
    //    which is the entire reason a machine-heard fact passes under a human's eyes — and accepts
    //    the group in one act.
    const proposedFilterSize = details.memories.find(
      (memory) => memory.label === "Filter size",
    ) as (typeof details.memories)[number];
    expect(proposedFilterSize.value).toEqual({ type: "text", text: "EDR1RXD" });

    await review.editSuggestedAssetMemory({
      actorUserId: OWNER,
      memoryId: proposedFilterSize.id,
      edit: { value: { type: "text", text: FILTER_MODEL } },
    });
    await review.acceptAssetReviewGroup({ actorUserId: OWNER, groupId: details.group.id });

    const memories = await review.listAssetMemories({ callerUserId: OWNER, assetId: asset.id });
    expect(memories.map((memory) => [memory.label, memory.status]).sort()).toEqual([
      ["Filter size", "active"],
      ["Replacement interval", "active"],
    ]);

    // The corrected value is the one that became durable — the edit is the review, not a note on
    // the side of it.
    const filterSize = memories.find(
      (memory) => memory.label === "Filter size",
    ) as (typeof memories)[number];
    expect(filterSize.value).toEqual({ type: "text", text: FILTER_MODEL });

    // The evidence keeps its provenance: which review it arrived through, after review resolved.
    const evidence = await review.listAssetEvidence({ callerUserId: OWNER, assetId: asset.id });
    expect(evidence.map((item) => [item.id, item.reviewGroupId])).toEqual([
      [receipt.id, details.group.id],
    ]);

    // The action's link followed the row in place — it never pointed at a husk (ADR 0156).
    const linkedAssets = await bridge.listLinkedAssetsForGeneralActions({
      callerUserId: OWNER,
      generalActionIds: [action.id],
    });
    expect(linkedAssets[action.id]?.map((entry) => entry.asset.id)).toEqual([asset.id]);

    // 8) EMBEDDED = FINDABLE. Acceptance is what enqueues the embedding, so "reviewed" and
    //    "retrievable" are the same event; an accepted fact that was never embedded would be a
    //    memory the user can see and Eve cannot.
    // Acceptance is what makes the records retrievable, and it must be acceptance: the embedding
    // processor SKIPS a memory whose anchor is not yet durable (`decideAssetMemoryEmbedding`), so
    // an enqueue that happened while the asset was still a proposal was thrown away. Unless the
    // accept re-enqueues both, the asset and its facts are never embedded at all — visible on the
    // profile, and invisible to the semantic tier of the search Eve answers from.
    expect(world.embedded).toContainEqual({ recordKind: "asset", recordId: asset.id });
    expect(world.embedded).toContainEqual({
      recordKind: "asset_memory",
      recordId: filterSize.id,
    });

    const memberships = await store.listHouseholdMemberships({
      householdId: world.household.id,
      status: "active",
    });
    const search = searchOver({ assets: [asset], memories, evidence, memberships });

    // The question the whole phase exists to answer, and the exact value it must answer with.
    const hits = await search.searchAssets({
      ownerUserId: OWNER,
      query: "what filter does the fridge need?",
    });
    const factHit = hits.find((hit) => hit.recordId === filterSize.id);
    expect(factHit?.value).toEqual({ type: "text", text: FILTER_MODEL });
    expect(factHit?.trustLevel).toBe("asset_fact");
    expect(factHit?.visibilityLabel).toBe("Whole household");

    // And typing the part number itself finds it exactly — the structured tier (#204).
    const exact = await search.searchAssets({ ownerUserId: OWNER, query: FILTER_MODEL });
    expect(exact.map((hit) => hit.recordId)).toContain(filterSize.id);

    // 9) THE SNAPSHOT CITES THE RECORDS. Generated prose is a cache; what makes it safe is that
    //    it names the exact rows it was built from, so a consumer can always go and read them.
    const cached = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });
    expect(cached.status).toBe("rebuilt");
    expect(cached.snapshot?.supportingReferences.assetMemoryIds).toEqual(
      memories.map((memory) => memory.id),
    );
    expect(cached.snapshot?.supportingReferences.assetEvidenceIds).toEqual([receipt.id]);
    // The records travel with it, always — which is what lets a stale summary degrade the card
    // rather than the truth.
    expect(cached.context.memories.map((memory) => memory.id)).toEqual(
      memories.map((memory) => memory.id),
    );

    // 10) THE REMINDER. The reviewed cadence proposes a Suggested Routine — and only a suggested
    //    one. Eve is not an asset manager, and the ledger stays untouched until the owner says so.
    const proposed = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
      source: "assistant",
    });
    expect(proposed.proposed).toHaveLength(1);
    const reminder = proposed.proposed[0]?.action as NonNullable<
      (typeof proposed.proposed)[number]
    >["action"];
    expect(reminder.status).toBe("suggested");
    expect(reminder.recurrence).toEqual({ interval: 6, unit: "month" });
    expect(classifyActionSurfacing(reminder, NOW)).toBeNull();

    const promotedReminder = await actionReview.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: reminder.id,
    });
    expect(promotedReminder.action.status).toBe("open");

    // Accepted, it is an ordinary Action: on the ledger, on the Asset's profile, and surfacing
    // proactively when due — with no asset-specific plumbing anywhere (#203).
    const ledger = await actions.listActiveGeneralActions({ ownerUserId: OWNER });
    expect(ledger.map((entry) => entry.id)).toContain(reminder.id);
    const assetActions = await bridge.listLinkedGeneralActionsForAsset({
      callerUserId: OWNER,
      assetId: asset.id,
    });
    expect(assetActions.map((entry) => entry.action.id)).toContain(reminder.id);
    expect(classifyActionSurfacing(promotedReminder.action, reminder.dueAt as Date)).not.toBeNull();

    // 11) HISTORY. The Asset's story is retold from the records themselves, not a second log.
    const timeline = await world.history.listAssetHistory({
      callerUserId: OWNER,
      assetId: asset.id,
    });
    expect(timeline.some((entry) => entry.type === "memory")).toBe(true);
    expect(timeline.some((entry) => entry.type === "evidence")).toBe(true);
    expect(timeline.some((entry) => entry.type === "action")).toBe(true);

    // 12) HOUSEHOLD SCOPE, EARNED. The member can now see the thing and its facts — because the
    //     owner accepted them, not because the asset existed.
    expect((await assets.listAssets({ callerUserId: MEMBER })).map((row) => row.id)).toEqual([
      asset.id,
    ]);
    const memberView = await review.listAssetMemories({
      callerUserId: MEMBER,
      assetId: asset.id,
    });
    expect(memberView.map((memory) => memory.label).sort()).toEqual([
      "Filter size",
      "Replacement interval",
    ]);
  });

  it("keeps a co-member's private detail on the shared Asset invisible to the Asset's own owner", async () => {
    const world = await seedJourney();
    const { store, review, snapshots } = world;

    const asset = await world.assets.createAsset({
      ownerUserId: OWNER,
      name: "Kitchen refrigerator",
      kind: "appliance",
      scope: "household",
      householdId: world.household.id,
    });
    const shared = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Filter size",
      value: { type: "text", text: FILTER_MODEL },
      scope: "household",
    });

    // The member hangs their own private detail — and their own private receipt — on the shared
    // Asset. This is the child-scope ceiling working in the direction people forget: the Asset is
    // household, the record is not, and the *Asset's owner* is on the outside of it.
    const privateQuote = await review.createActiveAssetMemory({
      ownerUserId: MEMBER,
      assetId: asset.id,
      label: "Compressor repair quote",
      value: { type: "amount", amount: 840, currency: "USD" },
      scope: "private",
    });
    const privateReceipt = await review.addAssetEvidence({
      ownerUserId: MEMBER,
      assetId: asset.id,
      kind: "receipt",
      label: "Compressor repair receipt",
      capturedText: "Compressor swap, paid privately.",
      scope: "private",
    });

    const ownerMemories = await review.listAssetMemories({
      callerUserId: OWNER,
      assetId: asset.id,
    });
    expect(ownerMemories.map((memory) => memory.id)).toEqual([shared.id]);
    const ownerEvidence = await review.listAssetEvidence({
      callerUserId: OWNER,
      assetId: asset.id,
    });
    expect(ownerEvidence).toEqual([]);

    // Not in the owner's search…
    const memberships = await store.listHouseholdMemberships({
      householdId: world.household.id,
      status: "active",
    });
    const search = searchOver({
      assets: [asset],
      memories: [shared, privateQuote],
      evidence: [privateReceipt],
      memberships,
    });
    const ownerHits = await search.searchAssets({ ownerUserId: OWNER, query: "compressor repair" });
    expect(ownerHits).toEqual([]);

    // …and not in the snapshot the owner's Asset Profile shows, nor in what it cites. A cache
    // that widened access would be the worst kind of leak: silent, and quoted with confidence.
    const cached = await snapshots.getAssetSnapshot({ callerUserId: OWNER, assetId: asset.id });
    expect(cached.snapshot?.summary).not.toContain("Compressor");
    expect(cached.snapshot?.supportingReferences.assetMemoryIds).toEqual([shared.id]);
    expect(cached.snapshot?.supportingReferences.assetEvidenceIds).toEqual([]);

    // The member, of course, sees their own.
    const memberHits = await search.searchAssets({
      ownerUserId: MEMBER,
      query: "compressor repair",
    });
    expect(memberHits.map((hit) => hit.recordId)).toContain(privateQuote.id);
  });
});
