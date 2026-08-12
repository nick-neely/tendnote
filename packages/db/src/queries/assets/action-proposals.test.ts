import { AssetValidationError } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { createSuggestedGeneralActionReview } from "../general-actions/review";
import { createAssetActionLinks } from "./action-links";
import { createAssetActionProposals } from "./action-proposals";
import { createAuditKindsReader, seedOwnerMemberHousehold } from "./asset-test-fixtures";
import { createAssetHistory } from "./history";
import { createInMemoryAssetActionLinkStore } from "./in-memory-action-link-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAssetReview } from "./review";

const OWNER = "user-1";
const MEMBER = "user-member";

/** A fixed "now" so a proposal's timing is a fact, not a race with the clock. */
const NOW = new Date(2026, 6, 13, 9, 30);

function setup() {
  const store = createInMemoryAssetActionLinkStore();
  const scheduled: { recordKind: string; recordId: string }[] = [];
  const proposals = createAssetActionProposals(store, {
    scheduleGeneralActionEmbedding: async ({ recordKind, recordId }) => {
      scheduled.push({ recordKind, recordId });
    },
  });
  const links = createAssetActionLinks(store);
  const review = createAssetReview(store);
  const assetLifecycle = createAssetLifecycle(store);
  const actionLifecycle = createGeneralActionLifecycle(store);
  const actionReview = createSuggestedGeneralActionReview(store);
  const history = createAssetHistory(store);
  const auditKinds = createAuditKindsReader(assetLifecycle, OWNER);

  async function seedAsset(
    overrides: { scope?: "private" | "household"; householdId?: string } = {},
  ) {
    const asset = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator water filter",
      kind: "item",
      ...overrides,
    });
    return asset;
  }

  function seedMemory(
    assetId: string,
    overrides: Partial<Parameters<typeof review.createActiveAssetMemory>[0]> = {},
  ) {
    return review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId,
      label: "Replacement interval",
      value: { type: "interval", interval: 6, unit: "month" },
      ...overrides,
    });
  }

  /** One proposal pass over an asset, at the fixed instant these tests reason about. */
  function propose(assetId: string, overrides: { assetMemoryIds?: string[] } = {}) {
    return proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId,
      now: NOW,
      ...overrides,
    });
  }

  /** The common arrangement: an asset with one reviewed detail that has proposed. */
  async function seedProposed(memoryOverrides: Parameters<typeof seedMemory>[1] = {}) {
    const asset = await seedAsset();
    const memory = await seedMemory(asset.id, memoryOverrides);
    const { proposed } = await propose(asset.id);
    return { asset, memory, proposed, actionId: proposed[0]?.action.id ?? "" };
  }

  /** Acceptance always runs through the existing General Action review path. */
  function accept(generalActionId: string, edit?: { title: string }) {
    return actionReview.acceptSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId,
      ...(edit ? { edit } : {}),
    });
  }

  return {
    store,
    scheduled,
    proposals,
    links,
    review,
    assetLifecycle,
    actionLifecycle,
    actionReview,
    history,
    auditKinds,
    seedAsset,
    seedMemory,
    propose,
    seedProposed,
    accept,
  };
}

describe("proposeAssetMemoryActions", () => {
  it("proposes a Suggested Routine from a reviewed replacement interval", async () => {
    const { proposals, seedAsset, seedMemory } = setup();
    const asset = await seedAsset();
    const memory = await seedMemory(asset.id);

    const result = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
    });

    expect(result.proposed).toHaveLength(1);
    const [proposal] = result.proposed;
    expect(proposal?.reason).toBe("replacement");
    expect(proposal?.assetMemoryId).toBe(memory.id);
    // A proposal is born SUGGESTED — never an active action on the ledger.
    expect(proposal?.action.status).toBe("suggested");
    expect(proposal?.action.title).toBe("Replace Refrigerator water filter");
    expect(proposal?.action.recurrence).toEqual({ interval: 6, unit: "month" });
  });

  it("keeps a proposal off every active surface until it is accepted", async () => {
    const { proposals, actionLifecycle, links, seedAsset, seedMemory } = setup();
    const asset = await seedAsset();
    await seedMemory(asset.id);

    await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
    });

    // Not on the Actions ledger…
    expect(await actionLifecycle.listActiveGeneralActions({ ownerUserId: OWNER })).toEqual([]);
    // …and not in the Asset Profile's related-actions read, which shows durable
    // actions only. It lives in review, and nowhere else.
    expect(
      await links.listLinkedGeneralActionsForAsset({ callerUserId: OWNER, assetId: asset.id }),
    ).toEqual([]);
  });

  it("promotes an accepted proposal onto the ledger and the Asset Profile", async () => {
    const { actionLifecycle, links, seedProposed, accept } = setup();
    const { asset, actionId } = await seedProposed();

    // Accepted through the EXISTING General Action review path — no asset-specific
    // acceptance path exists, and the link never has to move (the row flips in place).
    const accepted = await accept(actionId);
    expect(accepted.action.status).toBe("open");

    const active = await actionLifecycle.listActiveGeneralActions({ ownerUserId: OWNER });
    expect(active.map((action) => action.id)).toEqual([actionId]);

    const linked = await links.listLinkedGeneralActionsForAsset({
      callerUserId: OWNER,
      assetId: asset.id,
    });
    expect(linked.map((entry) => entry.action.id)).toEqual([actionId]);
  });

  it("lets the owner dismiss or ignore a proposal through the existing review path", async () => {
    const { proposals, actionReview, seedAsset, seedMemory } = setup();
    const asset = await seedAsset();
    await seedMemory(asset.id);
    await seedMemory(asset.id, {
      label: "Warranty expires",
      value: { type: "date", date: "2026-09-01" },
    });

    const { proposed } = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
    });
    expect(proposed).toHaveLength(2);

    const dismissed = await actionReview.dismissSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: proposed[0]?.action.id ?? "",
    });
    expect(dismissed.status).toBe("dismissed");

    const ignored = await actionReview.ignoreSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: proposed[1]?.action.id ?? "",
    });
    expect(ignored.status).toBe("ignored");
  });

  it("edits a proposal before accepting it, through the existing review path", async () => {
    const { seedProposed, accept } = setup();
    const { actionId } = await seedProposed();

    const accepted = await accept(actionId, { title: "Swap the fridge filter" });

    expect(accepted.action.title).toBe("Swap the fridge filter");
    expect(accepted.action.status).toBe("open");
  });
});

describe("proposal idempotency", () => {
  it("never proposes twice from the same memory", async () => {
    const { proposals, seedAsset, seedMemory } = setup();
    const asset = await seedAsset();
    const memory = await seedMemory(asset.id);

    const first = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
    });
    const second = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
    });

    expect(first.proposed).toHaveLength(1);
    expect(second.proposed).toHaveLength(0);
    // The memory keeps exactly one proposal — the first one.
    const pending = await proposals.listPendingAssetActionProposals({
      actorUserId: OWNER,
      assetId: asset.id,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.assetMemoryId).toBe(memory.id);
  });

  it("does not re-propose a memory whose proposal was dismissed", async () => {
    // A rejected proposal stays rejected. Re-proposing what the owner just turned down
    // is the nag loop the review gate exists to prevent (mirrors action extraction,
    // which likewise never reintroduces a dismissed suggestion).
    const { propose, actionReview, seedProposed } = setup();
    const { asset, actionId } = await seedProposed();
    await actionReview.dismissSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });

    const again = await propose(asset.id);

    expect(again.proposed).toHaveLength(0);
  });

  it("reports a dismissed detail as spoken-for, so the surface cannot claim it has a reminder", async () => {
    // The empty pass after a dismissal is *not* "these already have reminders" — the
    // detail has none; it was refused. The seam reports the count so the profile can say
    // what actually happened instead of inventing a comfortable, false one.
    const { propose, actionReview, seedProposed } = setup();
    const { asset, actionId } = await seedProposed();
    await actionReview.dismissSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });

    const again = await propose(asset.id);

    expect(again.proposed).toHaveLength(0);
    expect(again.alreadySpokenFor).toBe(1);
  });

  it("reports nothing spoken-for when no detail has ever proposed", async () => {
    // The other empty pass, and a different sentence: this asset simply carries no dated
    // detail. Conflating the two is what let the profile lie after a dismissal.
    const { propose, seedAsset, seedMemory } = setup();
    const asset = await seedAsset();
    await seedMemory(asset.id, { label: "Filter size", value: { type: "text", text: "RPWFE" } });

    const pass = await propose(asset.id);

    expect(pass.proposed).toHaveLength(0);
    expect(pass.alreadySpokenFor).toBe(0);
  });

  it("keeps a dismissed proposal out of the asset's related actions — a refusal is not a tombstone", async () => {
    // Dismissal is how the owner says "no". A permanent, unremovable "Dismissed" row in
    // the profile's ledger turns that "no" into a monument to it; the resolved trail
    // lives on the Actions surface and in Asset History, where it can be reopened.
    const { propose, actionReview, links, seedProposed } = setup();
    const { asset, actionId } = await seedProposed();
    await actionReview.dismissSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });

    await propose(asset.id);

    expect(
      await links.listLinkedGeneralActionsForAsset({ callerUserId: OWNER, assetId: asset.id }),
    ).toEqual([]);
  });

  it("still keeps a completed action — that is something that happened to the thing", async () => {
    const { actionLifecycle, links, seedProposed, accept } = setup();
    // A one-off dated proposal, not a Routine: completing a Routine rolls it forward,
    // and what this pins is that a *terminal* completion still reads as the asset's
    // history — only a refusal is erased.
    const { asset, actionId } = await seedProposed({
      label: "Warranty expires",
      value: { type: "date", date: "2027-01-04" },
    });
    await accept(actionId);
    await actionLifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: actionId });

    const linked = await links.listLinkedGeneralActionsForAsset({
      callerUserId: OWNER,
      assetId: asset.id,
    });

    expect(linked.map((entry) => entry.action.status)).toEqual(["completed"]);
  });

  it("revives a memory whose proposal was set aside — ignore is not a one-way door", async () => {
    // The lifecycle's own contract for an ignored proposal is "propose it again to act
    // on it" (accepting an ignored row throws). If proposal generation treated ignore as
    // final, the profile's set-aside button would be a one-way door: one misclick and
    // this memory could never remind the owner again.
    const { propose, actionReview, actionLifecycle, seedProposed, accept } = setup();
    const { asset, memory, actionId } = await seedProposed();
    await actionReview.ignoreSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });

    const again = await propose(asset.id);

    expect(again.proposed).toHaveLength(1);
    expect(again.proposed[0]?.assetMemoryId).toBe(memory.id);
    const revivedId = again.proposed[0]?.action.id ?? "";
    expect(revivedId).not.toBe(actionId);

    // The revived proposal is a real, acceptable one — the whole point of reviving.
    const accepted = await accept(revivedId);
    expect(accepted.action.status).toBe("open");
    const active = await actionLifecycle.listActiveGeneralActions({ ownerUserId: OWNER });
    expect(active.map((action) => action.id)).toEqual([revivedId]);
  });

  it("leaves one link behind when a set-aside memory proposes again", async () => {
    // Reviving clears the husk link rather than stacking a second row on the same
    // detail, so the profile never shows one memory proposing twice.
    const { store, propose, actionReview, seedProposed } = setup();
    const { asset, memory, actionId } = await seedProposed();
    await actionReview.ignoreSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    await propose(asset.id);

    const links = await store.listGeneralActionAssetLinksForAsset({ assetId: asset.id });
    const forMemory = links.filter((link) => link.assetMemoryId === memory.id);
    expect(forMemory).toHaveLength(1);
  });

  it("does not revive a set-aside memory twice in a row", async () => {
    // Once revived, the fresh proposal is pending — and a pending proposal is a memory
    // that has already had its say. A second pass must not stack another.
    const { propose, actionReview, seedProposed } = setup();
    const { asset, actionId } = await seedProposed();
    await actionReview.ignoreSuggestedGeneralAction({
      actorUserId: OWNER,
      generalActionId: actionId,
    });
    await propose(asset.id);

    const third = await propose(asset.id);

    expect(third.proposed).toHaveLength(0);
  });

  it("does not re-propose a memory whose proposal was accepted", async () => {
    const { propose, seedProposed, accept } = setup();
    const { asset, actionId } = await seedProposed();
    await accept(actionId);

    const again = await propose(asset.id);

    expect(again.proposed).toHaveLength(0);
  });
});

describe("proposal gating", () => {
  it("proposes nothing from a memory still waiting in review", async () => {
    const { proposals, review, store, seedAsset } = setup();
    const asset = await seedAsset();
    const source = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Filter is replaced every 6 months.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await review.suggestAssetMemories({
      ownerUserId: OWNER,
      assetId: asset.id,
      sourceRecordId: source.id,
      memories: [
        { label: "Replacement interval", value: { type: "interval", interval: 6, unit: "month" } },
      ],
    });

    const result = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
    });

    // The fact itself is not yet true. A suggestion cannot cascade into a second
    // suggestion downstream of its own review gate.
    expect(result.proposed).toEqual([]);
  });

  it("refuses to propose against an archived asset", async () => {
    const { proposals, assetLifecycle, seedAsset, seedMemory } = setup();
    const asset = await seedAsset();
    await seedMemory(asset.id);
    await assetLifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id });

    await expect(
      proposals.proposeAssetMemoryActions({ actorUserId: OWNER, assetId: asset.id, now: NOW }),
    ).rejects.toBeInstanceOf(AssetValidationError);
  });

  it("refuses a co-member on someone else's asset, and allows one on the household's own", async () => {
    const { proposals, assetLifecycle, store, seedAsset, seedMemory } = setup();
    const household = await seedOwnerMemberHousehold(store, OWNER, MEMBER);
    const asset = await seedAsset();
    await seedMemory(asset.id);

    // Proposing new review items in someone else's queue is not theirs to do,
    // and the refusal is the one opaque sentence (ADR 0219).
    await expect(
      proposals.proposeAssetMemoryActions({ actorUserId: MEMBER, assetId: asset.id, now: NOW }),
    ).rejects.toThrow(/no longer available/);

    // The household's own asset is a different question: every active member
    // holds the same authority over it, so any of them may propose (ADR 0214).
    const fridge = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Kitchen refrigerator",
      kind: "appliance",
      ownership: "household_native",
      householdId: household.id,
    });
    await seedMemory(fridge.id);
    await expect(
      proposals.proposeAssetMemoryActions({ actorUserId: MEMBER, assetId: fridge.id, now: NOW }),
    ).resolves.toBeDefined();
  });

  it("never widens a private memory into a household action", async () => {
    // The proposal's notes quote the memory. A private detail under a household asset
    // must not reach co-members by riding out on a household-scoped action.
    const { proposals, store, seedAsset, seedMemory } = setup();
    const household = await seedOwnerMemberHousehold(store, OWNER, MEMBER);
    const asset = await seedAsset({ scope: "household", householdId: household.id });
    await seedMemory(asset.id, { scope: "private" });

    const { proposed } = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
    });

    expect(proposed[0]?.action.scope).toBe("private");
    expect(proposed[0]?.action.householdId).toBeNull();
  });

  it("lets a household memory propose a household action", async () => {
    const { proposals, store, seedAsset, seedMemory } = setup();
    const household = await seedOwnerMemberHousehold(store, OWNER, MEMBER);
    const asset = await seedAsset({ scope: "household", householdId: household.id });
    await seedMemory(asset.id, { scope: "household" });

    const { proposed } = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
    });

    expect(proposed[0]?.action.scope).toBe("household");
    expect(proposed[0]?.action.householdId).toBe(household.id);
  });

  it("narrows the selection to the memories the caller named", async () => {
    const { proposals, seedAsset, seedMemory } = setup();
    const asset = await seedAsset();
    await seedMemory(asset.id);
    const warranty = await seedMemory(asset.id, {
      label: "Warranty expires",
      value: { type: "date", date: "2026-09-01" },
    });

    const { proposed } = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      assetMemoryIds: [warranty.id],
      now: NOW,
    });

    expect(proposed.map((entry) => entry.assetMemoryId)).toEqual([warranty.id]);
  });
});

describe("proposal provenance", () => {
  it("writes the proposal to the asset's audit trail with its reason", async () => {
    const { proposals, auditKinds, assetLifecycle, seedAsset, seedMemory } = setup();
    const asset = await seedAsset();
    const memory = await seedMemory(asset.id);

    const { proposed } = await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      source: "assistant",
      now: NOW,
    });

    expect(await auditKinds(asset.id)).toContain("action_proposed");

    const events = await assetLifecycle.listAssetAudit({ ownerUserId: OWNER, assetId: asset.id });
    const proposal = events.find((event) => event.kind === "action_proposed");
    expect(proposal?.source).toBe("assistant");
    expect(proposal?.detailJson).toMatchObject({
      generalActionId: proposed[0]?.action.id ?? "",
      assetMemoryId: memory.id,
      reason: "replacement",
    });
  });

  it("tells the profile which detail a proposal came from", async () => {
    const { proposals, links, seedAsset, seedMemory } = setup();
    const asset = await seedAsset();
    const memory = await seedMemory(asset.id);

    await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
    });

    const pending = await proposals.listPendingAssetActionProposals({
      actorUserId: OWNER,
      assetId: asset.id,
    });

    expect(pending).toHaveLength(1);
    expect(pending[0]?.assetMemoryId).toBe(memory.id);
    expect(pending[0]?.memoryLabel).toBe("Replacement interval");
    expect(pending[0]?.action.status).toBe("suggested");

    // The pending proposal is review state: it is not a durable linked action.
    expect(
      await links.listLinkedGeneralActionsForAsset({ callerUserId: OWNER, assetId: asset.id }),
    ).toEqual([]);
  });

  it("hides a pending proposal from a co-member — review is owner-only", async () => {
    const { proposals, store, assetLifecycle, seedMemory } = setup();
    const household = await seedOwnerMemberHousehold(store, OWNER, MEMBER);
    const asset = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Household refrigerator",
      kind: "appliance",
      ownership: "household_native",
      householdId: household.id,
    });
    await seedMemory(asset.id, { scope: "household" });

    await proposals.proposeAssetMemoryActions({
      actorUserId: OWNER,
      assetId: asset.id,
      now: NOW,
    });

    expect(
      await proposals.listPendingAssetActionProposals({ actorUserId: MEMBER, assetId: asset.id }),
    ).toEqual([]);
  });

  it("keeps the accepted action's lifecycle in Asset History — one lifecycle source", async () => {
    const { actionLifecycle, history, seedProposed, accept } = setup();
    const { asset, actionId } = await seedProposed();
    await accept(actionId);
    await actionLifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: actionId });

    const entries = await history.listAssetHistory({ callerUserId: OWNER, assetId: asset.id });
    const actionEntries = entries.filter((entry) => entry.type === "action");

    // The action's own history is what the profile renders — the asset never keeps a
    // parallel maintenance log (#196).
    expect(actionEntries.map((entry) => entry.event)).toContain("completed");
  });
});

describe("proposal embed-on-write", () => {
  it("embeds a proposal when it is suggested, like every other suggested action", async () => {
    // `suggestGeneralAction` embeds a proposal on write so it is findable in owner-only
    // review context (ADR 0150, #184). An asset-derived proposal is the same kind of
    // record; skipping this would leave only these proposals invisible to recall while
    // they sit pending.
    const { scheduled, seedProposed } = setup();
    const { actionId } = await seedProposed();

    expect(scheduled).toEqual([{ recordKind: "general_action", recordId: actionId }]);
  });

  it("embeds nothing when a pass proposes nothing", async () => {
    const { scheduled, propose, seedAsset, seedMemory } = setup();
    const asset = await seedAsset();
    await seedMemory(asset.id, { label: "Filter size", value: { type: "text", text: "EDR1RXD1" } });

    await propose(asset.id);

    expect(scheduled).toEqual([]);
  });
});
