import { AssetValidationError } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { createSuggestedGeneralActionReview } from "../general-actions/review";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { createAssetActionLinks } from "./action-links";
import { createInMemoryAssetActionLinkStore } from "./in-memory-action-link-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAssetReview } from "./review";

const OWNER = "user-1";

const HINT = "refrigerator water filter";

function setup() {
  const store = createInMemoryAssetActionLinkStore();
  const links = createAssetActionLinks(store);
  const review = createAssetReview(store);
  const assetLifecycle = createAssetLifecycle(store);
  const actionLifecycle = createGeneralActionLifecycle(store);
  const actionReview = createSuggestedGeneralActionReview(store);

  function seedSource(overrides: Partial<Parameters<typeof store.createSourceRecord>[0]> = {}) {
    return store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Fridge filter is due again — EDR3RXD1, every 6 months.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
      ...overrides,
    });
  }

  function seedAction(
    overrides: Partial<Parameters<typeof actionLifecycle.createGeneralAction>[0]> = {},
  ) {
    return actionLifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      assetHints: [{ label: HINT }],
      ...overrides,
    });
  }

  function seedHousehold() {
    return seedHouseholdWithMembers(store, {
      ownerUserId: OWNER,
      members: [
        [OWNER, "owner"],
        ["user-member", "member"],
      ],
    });
  }

  const auditEvents = (assetId: string, ownerUserId = OWNER) =>
    assetLifecycle.listAssetAudit({ ownerUserId, assetId });

  return {
    store,
    links,
    review,
    assetLifecycle,
    actionLifecycle,
    actionReview,
    seedSource,
    seedAction,
    seedHousehold,
    auditEvents,
  };
}

describe("promote an asset hint into a suggested asset", () => {
  it("opens a pending review group anchored to a suggested asset named after the hint", async () => {
    const { links, review, assetLifecycle, seedAction, seedSource } = setup();
    const source = await seedSource();
    const action = await seedAction({ sourceRecordId: source.id });

    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });

    if (result.outcome !== "pending_review") throw new Error("expected a pending review");
    expect(result.group.asset.name).toBe(HINT);
    expect(result.group.asset.status).toBe("suggested");
    expect(result.group.asset.kind).toBe("item");
    expect(result.group.assetPending).toBe(true);
    // Source grounding rides from the action onto the review group.
    expect(result.group.group.sourceRecordId).toBe(source.id);

    // The proposal enters the shared Review Queue, and nothing durable exists yet.
    const queue = await review.listAssetReviewGroups({ ownerUserId: OWNER });
    expect(queue.map((entry) => entry.group.id)).toEqual([result.group.group.id]);
    await expect(assetLifecycle.listAssets({ callerUserId: OWNER })).resolves.toEqual([]);
  });

  it("promotes an ungrounded (user-created) action's hint with a null-source group", async () => {
    const { links, seedAction } = setup();
    const action = await seedAction();

    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
      kind: "appliance",
    });

    if (result.outcome !== "pending_review") throw new Error("expected a pending review");
    expect(result.group.group.sourceRecordId).toBeNull();
    expect(result.group.asset.kind).toBe("appliance");
  });

  it("argues the action's household visibility for the proposal", async () => {
    const { links, seedAction, seedHousehold } = setup();
    const household = await seedHousehold();
    const action = await seedAction({ scope: "household", householdId: household.id });

    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });

    if (result.outcome !== "pending_review") throw new Error("expected a pending review");
    expect(result.group.asset.scope).toBe("household");
    expect(result.group.asset.householdId).toBe(household.id);
  });

  it("requires the hint to exist on the action, matched case-insensitively", async () => {
    const { links, seedAction } = setup();
    const action = await seedAction();

    await expect(
      links.promoteGeneralActionAssetHint({
        actorUserId: OWNER,
        generalActionId: action.id,
        hintLabel: "garage door opener",
      }),
    ).rejects.toThrow(AssetValidationError);

    // Case and surrounding whitespace never block a promote.
    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: "  Refrigerator Water Filter ",
    });
    expect(result.outcome).toBe("pending_review");
  });

  it("is owner-only and refuses a still-suggested action", async () => {
    const { links, seedAction, seedSource, actionReview } = setup();
    const action = await seedAction();

    await expect(
      links.promoteGeneralActionAssetHint({
        actorUserId: "user-outsider",
        generalActionId: action.id,
        hintLabel: HINT,
      }),
    ).rejects.toThrow("Action not found.");

    const source = await seedSource();
    const suggested = await actionReview.suggestGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the furnace filter",
      assetHints: [{ label: "furnace filter" }],
      sourceRecordId: source.id,
    });
    await expect(
      links.promoteGeneralActionAssetHint({
        actorUserId: OWNER,
        generalActionId: suggested.action.id,
        hintLabel: "furnace filter",
      }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("is idempotent: re-promoting the same hint returns the existing pending group", async () => {
    const { links, review, seedAction } = setup();
    const action = await seedAction();

    const first = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });
    const again = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: "Refrigerator Water Filter",
    });

    if (first.outcome !== "pending_review" || again.outcome !== "pending_review") {
      throw new Error("expected pending reviews");
    }
    expect(again.group.group.id).toBe(first.group.group.id);
    const queue = await review.listAssetReviewGroups({ ownerUserId: OWNER });
    expect(queue).toHaveLength(1);
  });

  it("surfaces the duplicate prompt when the hint resembles an existing asset", async () => {
    const { links, assetLifecycle, seedAction } = setup();
    const existing = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Fridge filter",
      kind: "appliance",
    });
    await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Toyota Corolla",
      kind: "vehicle",
    });
    const action = await seedAction();

    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });

    if (result.outcome !== "pending_review") throw new Error("expected a pending review");
    expect(result.group.duplicateCandidates.map((asset) => asset.id)).toEqual([existing.id]);
  });

  it("passes the grounding gate as directly requested — a restricted source never blocks it", async () => {
    const { links, seedAction, seedSource } = setup();
    const restricted = await seedSource({ sensitivity: "restricted" });
    const action = await seedAction({ sourceRecordId: restricted.id });

    // Promotion is explicit user intent, so the ADR 0058 restricted-context gate
    // passes as directly requested rather than being silently bypassed.
    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });
    expect(result.outcome).toBe("pending_review");
  });

  it("names the originating action for a pending promoted proposal", async () => {
    const { links, review, seedAction, seedSource } = setup();
    const action = await seedAction();
    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });
    if (result.outcome !== "pending_review") throw new Error("expected a pending review");

    await expect(
      links.getPromotedFromGeneralAction({ ownerUserId: OWNER, assetId: result.group.asset.id }),
    ).resolves.toEqual({ id: action.id, title: "Replace the refrigerator water filter" });

    // A proposal that didn't come from an action hint has no origin.
    const source = await seedSource();
    const suggested = await review.suggestAsset({
      ownerUserId: OWNER,
      name: "Furnace filter",
      kind: "appliance",
      sourceRecordId: source.id,
    });
    await expect(
      links.getPromotedFromGeneralAction({ ownerUserId: OWNER, assetId: suggested.asset.id }),
    ).resolves.toBeNull();
  });

  it("records the promotion's provenance in the asset audit trail", async () => {
    const { links, seedAction, auditEvents } = setup();
    const action = await seedAction();

    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });

    if (result.outcome !== "pending_review") throw new Error("expected a pending review");
    const events = await auditEvents(result.group.asset.id);
    expect(events.map((event) => event.kind)).toEqual(["suggested"]);
    expect(events[0]?.detailJson).toMatchObject({
      promotedFromGeneralActionId: action.id,
      hintLabel: HINT,
      grounded: false,
    });
  });
});

describe("action ↔ asset display, both directions", () => {
  async function promoted() {
    const context = setup();
    const action = await context.seedAction();
    const result = await context.links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
      kind: "appliance",
    });
    if (result.outcome !== "pending_review") throw new Error("expected a pending review");
    return { ...context, action, group: result.group };
  }

  it("shows the owner a pending marker before review, and nothing on the asset side", async () => {
    const { links, action, group } = await promoted();

    const byAction = await links.listLinkedAssetsForGeneralActions({
      callerUserId: OWNER,
      generalActionIds: [action.id],
    });
    expect(byAction[action.id]).toHaveLength(1);
    expect(byAction[action.id]?.[0]).toMatchObject({
      hintLabel: HINT,
      pending: true,
    });

    // A pending proposal is not a durable Asset: its profile-side read is empty.
    await expect(
      links.listLinkedGeneralActionsForAsset({ callerUserId: OWNER, assetId: group.asset.id }),
    ).resolves.toEqual([]);
  });

  it("shows the link both ways once the proposal is accepted", async () => {
    const { links, review, action, group } = await promoted();
    await review.acceptSuggestedAsset({ actorUserId: OWNER, assetId: group.asset.id });

    const byAction = await links.listLinkedAssetsForGeneralActions({
      callerUserId: OWNER,
      generalActionIds: [action.id],
    });
    expect(byAction[action.id]?.[0]).toMatchObject({
      pending: false,
      hintLabel: HINT,
    });
    expect(byAction[action.id]?.[0]?.asset.id).toBe(group.asset.id);
    expect(byAction[action.id]?.[0]?.asset.status).toBe("active");

    const byAsset = await links.listLinkedGeneralActionsForAsset({
      callerUserId: OWNER,
      assetId: group.asset.id,
    });
    expect(byAsset).toHaveLength(1);
    expect(byAsset[0]?.action.id).toBe(action.id);
    expect(byAsset[0]?.hintLabel).toBe(HINT);
  });

  it("hides a dismissed proposal and lets the hint be promoted afresh", async () => {
    const { links, review, action, group, auditEvents } = await promoted();
    await review.dismissSuggestedAsset({ actorUserId: OWNER, assetId: group.asset.id });

    await expect(
      links.listLinkedAssetsForGeneralActions({
        callerUserId: OWNER,
        generalActionIds: [action.id],
      }),
    ).resolves.toEqual({});

    const again = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });
    if (again.outcome !== "pending_review") throw new Error("expected a fresh review");
    expect(again.group.group.id).not.toBe(group.group.id);
    expect(again.group.asset.id).not.toBe(group.asset.id);

    // Clearing the stale husk link is audited: the fresh proposal's suggested
    // event names the dismissed row it replaced.
    const events = await auditEvents(again.group.asset.id);
    expect(events[0]?.detailJson).toMatchObject({
      replacedDismissedAssetId: group.asset.id,
    });
  });

  it("never deletes a link whose durable asset merely became invisible", async () => {
    const { store, links, review, assetLifecycle, seedAction, seedHousehold } = setup();
    const household = await seedHousehold();
    // A co-member tracks the household asset this hint will link to.
    const memberAsset = await assetLifecycle.createAsset({
      ownerUserId: "user-member",
      name: "Refrigerator water filter",
      kind: "appliance",
      scope: "household",
      householdId: household.id,
    });
    const action = await seedAction();
    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });
    if (result.outcome !== "pending_review") throw new Error("expected a pending review");
    await review.linkAssetReviewGroup({
      actorUserId: OWNER,
      groupId: result.group.group.id,
      targetAssetId: memberAsset.id,
    });

    // The member narrows their asset to private: still durable, just invisible.
    await store.updateAsset({
      ownerUserId: "user-member",
      assetId: memberAsset.id,
      patch: { scope: "private", householdId: null },
    });

    // Re-promoting must not destroy the standing link or open a fresh proposal.
    await expect(
      links.promoteGeneralActionAssetHint({
        actorUserId: OWNER,
        generalActionId: action.id,
        hintLabel: HINT,
      }),
    ).rejects.toThrow(AssetValidationError);
    const remaining = await store.listGeneralActionAssetLinksForActions({
      generalActionIds: [action.id],
    });
    expect(remaining.map((link) => link.assetId)).toEqual([memberAsset.id]);

    // Once the member widens it again, the same promote reports the link.
    await store.updateAsset({
      ownerUserId: "user-member",
      assetId: memberAsset.id,
      patch: { scope: "household", householdId: household.id },
    });
    const after = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });
    expect(after).toMatchObject({ outcome: "already_linked", asset: { id: memberAsset.id } });
  });

  it("re-points the action's link when duplicate review links to an existing asset", async () => {
    const { links, review, assetLifecycle, seedAction, auditEvents } = setup();
    const existing = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Fridge filter",
      kind: "appliance",
    });
    const action = await seedAction();
    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });
    if (result.outcome !== "pending_review") throw new Error("expected a pending review");

    await review.linkAssetReviewGroup({
      actorUserId: OWNER,
      groupId: result.group.group.id,
      targetAssetId: existing.id,
    });

    // The action now shows the existing Asset — never the dismissed husk.
    const byAction = await links.listLinkedAssetsForGeneralActions({
      callerUserId: OWNER,
      generalActionIds: [action.id],
    });
    expect(byAction[action.id]?.map((entry) => entry.asset.id)).toEqual([existing.id]);
    expect(byAction[action.id]?.[0]?.pending).toBe(false);

    // And the existing Asset shows the action, hint provenance intact.
    const byAsset = await links.listLinkedGeneralActionsForAsset({
      callerUserId: OWNER,
      assetId: existing.id,
    });
    expect(byAsset.map((entry) => entry.action.id)).toEqual([action.id]);
    expect(byAsset[0]?.hintLabel).toBe(HINT);

    // Both audit trails record how many action links rode the resolution.
    const huskEvents = await auditEvents(result.group.asset.id);
    const linkedEvent = huskEvents.find((event) => event.kind === "linked_existing");
    expect(linkedEvent?.detailJson).toMatchObject({ actionsLinked: 1 });

    // Idempotent per hint: promoting again reports the existing link.
    const again = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
    });
    expect(again).toMatchObject({ outcome: "already_linked", asset: { id: existing.id } });
  });

  it("fails duplicate resolution when any linked Action cannot be mutated", async () => {
    const { store, links, review, assetLifecycle, actionLifecycle, seedAction, seedHousehold } =
      setup();
    const household = await seedHousehold();
    const target = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Fridge filter",
      kind: "appliance",
    });
    const authorizedAction = await seedAction();
    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: authorizedAction.id,
      hintLabel: HINT,
    });
    if (result.outcome !== "pending_review") throw new Error("expected a pending review");

    const inaccessibleAction = await actionLifecycle.createGeneralAction({
      ownerUserId: "user-member",
      title: "Member-owned shared action",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [OWNER],
    });
    await store.createGeneralActionAssetLink({
      createdByUserId: OWNER,
      generalActionId: inaccessibleAction.id,
      assetId: result.group.asset.id,
    });

    await expect(
      review.linkAssetReviewGroup({
        actorUserId: OWNER,
        groupId: result.group.group.id,
        targetAssetId: target.id,
      }),
    ).rejects.toThrow(/no longer available/);

    const rows = await store.listGeneralActionAssetLinksForActions({
      generalActionIds: [authorizedAction.id, inaccessibleAction.id],
    });
    expect(rows.find((row) => row.generalActionId === authorizedAction.id)?.assetId).toBe(
      result.group.asset.id,
    );
    expect(rows.find((row) => row.generalActionId === inaccessibleAction.id)?.assetId).toBe(
      result.group.asset.id,
    );
    await expect(
      store.getAsset({ ownerUserId: OWNER, assetId: result.group.asset.id }),
    ).resolves.toMatchObject({ status: "suggested" });
  });

  it("does not delete another member's link from the shared in-memory mutation seam", async () => {
    const { store, assetLifecycle, actionLifecycle, seedHousehold } = setup();
    const household = await seedHousehold();
    const asset = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Shared refrigerator",
      kind: "appliance",
    });
    const memberAction = await actionLifecycle.createGeneralAction({
      ownerUserId: "user-member",
      title: "Replace filter",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [OWNER],
    });
    const link = await store.createGeneralActionAssetLink({
      createdByUserId: "user-member",
      generalActionId: memberAction.id,
      assetId: asset.id,
    });

    await store.deleteGeneralActionAssetLink({
      callerUserId: OWNER,
      linkId: link.id,
      generalActionId: memberAction.id,
      assetId: asset.id,
    });

    await expect(
      store.listGeneralActionAssetLinksForActions({ generalActionIds: [memberAction.id] }),
    ).resolves.toMatchObject([{ id: link.id }]);
  });

  it("collapses a re-point that would duplicate an existing action link", async () => {
    const { links, review, assetLifecycle, actionLifecycle } = setup();
    const target = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator water filter",
      kind: "appliance",
    });
    const action = await actionLifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      assetHints: [{ label: HINT }, { label: "fridge filter" }],
    });

    for (const hintLabel of [HINT, "fridge filter"]) {
      const result = await links.promoteGeneralActionAssetHint({
        actorUserId: OWNER,
        generalActionId: action.id,
        hintLabel,
      });
      if (result.outcome !== "pending_review") throw new Error("expected a pending review");
      await review.linkAssetReviewGroup({
        actorUserId: OWNER,
        groupId: result.group.group.id,
        targetAssetId: target.id,
      });
    }

    // Two hints resolved to one Asset — the action shows a single link.
    const byAction = await links.listLinkedAssetsForGeneralActions({
      callerUserId: OWNER,
      generalActionIds: [action.id],
    });
    expect(byAction[action.id]?.map((entry) => entry.asset.id)).toEqual([target.id]);
  });

  it("filters each side independently under household scope", async () => {
    const { links, review, actionLifecycle, seedHousehold, seedAction } = setup();
    const household = await seedHousehold();
    const householdAction = await seedAction({ scope: "household", householdId: household.id });

    const result = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: householdAction.id,
      hintLabel: HINT,
    });
    if (result.outcome !== "pending_review") throw new Error("expected a pending review");

    // The member sees the household action but never the owner's pending proposal.
    await expect(
      links.listLinkedAssetsForGeneralActions({
        callerUserId: "user-member",
        generalActionIds: [householdAction.id],
      }),
    ).resolves.toEqual({});

    // Accepted at the argued household scope: the member now sees both directions.
    await review.acceptSuggestedAsset({ actorUserId: OWNER, assetId: result.group.asset.id });
    const memberByAction = await links.listLinkedAssetsForGeneralActions({
      callerUserId: "user-member",
      generalActionIds: [householdAction.id],
    });
    expect(memberByAction[householdAction.id]?.[0]?.asset.id).toBe(result.group.asset.id);
    const memberByAsset = await links.listLinkedGeneralActionsForAsset({
      callerUserId: "user-member",
      assetId: result.group.asset.id,
    });
    expect(memberByAsset.map((entry) => entry.action.id)).toEqual([householdAction.id]);

    // An outsider sees neither side; a caller who cannot see the action learns
    // nothing about its links even by guessing ids.
    await expect(
      links.listLinkedAssetsForGeneralActions({
        callerUserId: "user-outsider",
        generalActionIds: [householdAction.id],
      }),
    ).resolves.toEqual({});
    await expect(
      links.listLinkedGeneralActionsForAsset({
        callerUserId: "user-outsider",
        assetId: result.group.asset.id,
      }),
    ).resolves.toEqual([]);

    // A private asset linked to a household action stays the owner's alone.
    const privateAction = await actionLifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Order a spare filter",
      scope: "household",
      householdId: household.id,
      assetHints: [{ label: "spare filter" }],
    });
    const privateResult = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: privateAction.id,
      hintLabel: "spare filter",
    });
    if (privateResult.outcome !== "pending_review") throw new Error("expected a pending review");
    // Accept narrowed to private: the household action shows the asset to the
    // owner only.
    await review.acceptSuggestedAsset({
      actorUserId: OWNER,
      assetId: privateResult.group.asset.id,
      scope: "private",
    });
    const ownerSees = await links.listLinkedAssetsForGeneralActions({
      callerUserId: OWNER,
      generalActionIds: [privateAction.id],
    });
    expect(ownerSees[privateAction.id]).toHaveLength(1);
    await expect(
      links.listLinkedAssetsForGeneralActions({
        callerUserId: "user-member",
        generalActionIds: [privateAction.id],
      }),
    ).resolves.toEqual({});
  });
});

describe("the refrigerator water filter proof path (#196)", () => {
  it("carries a Phase 5 hint through review into an Asset with memory, visible both ways", async () => {
    const { links, review, assetLifecycle, actionLifecycle, seedSource } = setup();

    // Phase 5 left behind a grounded routine with a bare asset hint.
    const source = await seedSource({
      content: "Replace the fridge filter every 6 months. Model EDR3RXD1.",
    });
    const action = await actionLifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      recurrence: { interval: 6, unit: "month" },
      sourceRecordId: source.id,
      assetHints: [{ label: HINT }],
    });

    // The hint promotes into a review-gated lightweight anchor…
    const promotedResult = await links.promoteGeneralActionAssetHint({
      actorUserId: OWNER,
      generalActionId: action.id,
      hintLabel: HINT,
      kind: "appliance",
    });
    if (promotedResult.outcome !== "pending_review") throw new Error("expected a pending review");

    // …the owner reviews and accepts it, before any detailed memories exist…
    await review.acceptAssetReviewGroup({
      actorUserId: OWNER,
      groupId: promotedResult.group.group.id,
    });
    const asset = await assetLifecycle.getAsset({
      callerUserId: OWNER,
      assetId: promotedResult.group.asset.id,
    });
    expect(asset?.status).toBe("active");
    expect(asset?.name).toBe(HINT);

    // …then the filter's model number lands as an Asset Memory on the anchor.
    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: promotedResult.group.asset.id,
      label: "Filter model",
      value: { type: "text", text: "EDR3RXD1" },
      sourceRecordId: source.id,
    });
    const memories = await review.listAssetMemories({
      callerUserId: OWNER,
      assetId: promotedResult.group.asset.id,
    });
    expect(memories.map((memory) => memory.label)).toEqual(["Filter model"]);

    // The action shows its Asset; the Asset Profile shows the routine.
    const byAction = await links.listLinkedAssetsForGeneralActions({
      callerUserId: OWNER,
      generalActionIds: [action.id],
    });
    expect(byAction[action.id]?.map((entry) => entry.asset.name)).toEqual([HINT]);
    const byAsset = await links.listLinkedGeneralActionsForAsset({
      callerUserId: OWNER,
      assetId: promotedResult.group.asset.id,
    });
    expect(byAsset.map((entry) => entry.action.title)).toEqual([
      "Replace the refrigerator water filter",
    ]);
    expect(byAsset[0]?.action.recurrence).toEqual({ interval: 6, unit: "month" });
  });
});
