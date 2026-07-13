import {
  AssetValidationError,
  assetHintLabelsMatch,
  type GeneralAction,
  type GeneralActionAssetLink,
  isDurableAssetStatus,
  isReviewGeneralActionStatus,
} from "@tendnote/domain";
import type {
  AssetActionLinkStore,
  AssetLinkedGeneralAction,
  GeneralActionLinkedAsset,
  ListLinkedActionsInput,
  ListLinkedAssetsInput,
  PromoteGeneralActionAssetHintInput,
  PromoteGeneralActionAssetHintResult,
} from "./action-link-types";
import { resolveAssetVisibility } from "./lifecycle";
import {
  buildGroupResult,
  loadAnchor,
  openSuggestedAssetProposal,
  requireGrounding,
  requireGroupForAsset,
} from "./review-shared";

/**
 * The General Action ↔ Asset bridge (#199): a Phase 5 asset hint becomes (or
 * links to) a Phase 6 Asset through review, and each side can display the other
 * under its own scope rules. Module-scope steps + a thin factory, like the rest
 * of the review seam.
 */

/** Loads the promotable action, owner-only, and rejects review-state proposals. */
async function requirePromotableAction(
  store: AssetActionLinkStore,
  input: PromoteGeneralActionAssetHintInput,
): Promise<GeneralAction> {
  const action = await store.getGeneralAction({
    ownerUserId: input.actorUserId,
    generalActionId: input.generalActionId,
  });
  if (!action) {
    throw new Error("Action not found.");
  }
  // A suggested/ignored action is itself still review state — its hints become
  // assets only once the action is real (mirrors the durable-anchor rule).
  if (isReviewGeneralActionStatus(action.status)) {
    throw new AssetValidationError(
      "Accept the suggested action first — then its hints can become assets.",
    );
  }
  return action;
}

/**
 * Resolves an existing link for this hint, keeping promotion idempotent: a
 * still-pending proposal returns its open review group; a durable Asset returns
 * as already linked; only a genuinely dismissed husk — checked by the row's own
 * status, visibility-blind — is cleared so the hint can be proposed afresh
 * (returning the husk's id for the fresh proposal's audit trail). A durable
 * asset that merely became invisible (a co-member narrowed their record) is a
 * standing link: never deleted, surfaced as a curated refusal instead.
 */
async function resolveExistingHintLink(
  store: AssetActionLinkStore,
  actorUserId: string,
  link: GeneralActionAssetLink,
): Promise<PromoteGeneralActionAssetHintResult | { replacedDismissedAssetId: string }> {
  // Owner-keyed first: a proposal (or its dismissed husk) is always the
  // promoter's own row, whatever its visibility.
  const owned = await store.getAsset({ ownerUserId: actorUserId, assetId: link.assetId });
  if (owned?.status === "suggested") {
    const group = await requireGroupForAsset(store, {
      ownerUserId: actorUserId,
      assetId: owned.id,
    });
    return { outcome: "pending_review", group: await buildGroupResult(store, group) };
  }
  if (owned?.status === "dismissed") {
    await store.deleteGeneralActionAssetLink({ ownerUserId: link.ownerUserId, linkId: link.id });
    return { replacedDismissedAssetId: owned.id };
  }
  if (owned) {
    return { outcome: "already_linked", asset: owned };
  }

  // Not the promoter's row: duplicate review linked this hint to a co-member's
  // durable Asset. Their record stands whether or not it is currently visible —
  // an invisible link is never deleted, only reported.
  const visible = await store.getVisibleAsset({ callerUserId: actorUserId, assetId: link.assetId });
  if (visible) {
    return { outcome: "already_linked", asset: visible };
  }
  throw new AssetValidationError(
    "This hint is already linked to an asset you can't currently see.",
  );
}

/** The named hint on the action, matched case-insensitively, or a curated refusal. */
function requireHint(action: GeneralAction, hintLabel: string) {
  const hint = action.assetHints.find((candidate) =>
    assetHintLabelsMatch(candidate.label, hintLabel),
  );
  if (!hint) {
    throw new AssetValidationError("That hint isn't on this action anymore.");
  }
  return hint;
}

/**
 * The explicit grounding-gate exemption for promotion (ADRs 0058, 0151): a
 * grounded action's source passes the restricted-context check as *directly
 * requested* — the owner clicked Track on their own action, so this is direct
 * user intent, not a proactive inference. An ungrounded (user-created) action
 * skips the gate entirely, paralleling `createActiveAssetMemory`: the explicit
 * act is itself the provenance, and the group records a null source.
 */
async function requirePromotionGrounding(
  store: AssetActionLinkStore,
  action: GeneralAction,
): Promise<void> {
  if (action.sourceRecordId === null) {
    return;
  }
  await requireGrounding(store, {
    ownerUserId: action.ownerUserId,
    sourceRecordId: action.sourceRecordId,
    directlyRequested: true,
  });
}

/**
 * The visibility a promotion argues: the action's own audience (private or
 * household); a selected-shared audience is chosen at acceptance, mirroring
 * `suggestAsset`. Validated through the shared record-visibility rules.
 */
function resolveArguedVisibility(store: AssetActionLinkStore, action: GeneralAction) {
  const household = action.scope === "household";
  return resolveAssetVisibility(store, {
    ownerUserId: action.ownerUserId,
    scope: household ? "household" : "private",
    householdId: household ? action.householdId : null,
  });
}

/**
 * Promotes one of a General Action's asset hints into a review-gated Suggested
 * Asset (#199): a lightweight anchor named after the hint, opening an Asset
 * Review Group where the owner creates it, corrects it, links it to an existing
 * Asset (the duplicate prompt rides the group), or sets it aside. The action is
 * linked immediately — acceptance flips the same asset row in place, so the
 * link goes live without moving. Grounding rides from the action's own source
 * record where present (see `requirePromotionGrounding`); the audit trail
 * carries the action provenance either way. Owner-only and idempotent per hint.
 */
async function promoteGeneralActionAssetHint(
  store: AssetActionLinkStore,
  input: PromoteGeneralActionAssetHintInput,
): Promise<PromoteGeneralActionAssetHintResult> {
  const action = await requirePromotableAction(store, input);
  const hint = requireHint(action, input.hintLabel);

  const links = await store.listGeneralActionAssetLinksForActions({
    generalActionIds: [action.id],
  });
  const existing = links.find(
    (link) => link.hintLabel !== null && assetHintLabelsMatch(link.hintLabel, hint.label),
  );
  let replacedDismissedAssetId: string | null = null;
  if (existing) {
    const resolution = await resolveExistingHintLink(store, input.actorUserId, existing);
    if ("outcome" in resolution) {
      return resolution;
    }
    replacedDismissedAssetId = resolution.replacedDismissedAssetId;
  }

  await requirePromotionGrounding(store, action);
  const { scope, householdId } = await resolveArguedVisibility(store, action);

  const { asset, group } = await openSuggestedAssetProposal(store, {
    ownerUserId: action.ownerUserId,
    actorUserId: input.actorUserId,
    name: hint.label,
    kind: input.kind ?? "item",
    scope,
    householdId,
    sourceRecordId: action.sourceRecordId,
    auditSource: input.source ?? "user",
    auditDetail: {
      promotedFromGeneralActionId: action.id,
      hintLabel: hint.label,
      // Clearing a stale husk link is audited here: the fresh proposal names
      // the dismissed row it replaced.
      ...(replacedDismissedAssetId ? { replacedDismissedAssetId } : {}),
    },
  });

  await store.createGeneralActionAssetLink({
    ownerUserId: action.ownerUserId,
    generalActionId: action.id,
    assetId: asset.id,
    hintLabel: hint.label,
  });

  return { outcome: "pending_review", group: await buildGroupResult(store, group) };
}

/**
 * The General Action a proposal was promoted from, for review-card grounding
 * (#199): owner-keyed on both sides — review is owner-only, so only the owner's
 * own action can name a proposal's origin. Null for proposals that did not come
 * from an action hint.
 */
async function getPromotedFromGeneralAction(
  store: AssetActionLinkStore,
  input: { ownerUserId: string; assetId: string },
): Promise<Pick<GeneralAction, "id" | "title"> | null> {
  const links = await store.listGeneralActionAssetLinksForAsset({ assetId: input.assetId });
  for (const link of links) {
    if (link.ownerUserId !== input.ownerUserId || link.hintLabel === null) {
      continue;
    }
    const action = await store.getGeneralAction({
      ownerUserId: input.ownerUserId,
      generalActionId: link.generalActionId,
    });
    if (action) {
      return { id: action.id, title: action.title };
    }
  }
  return null;
}

/**
 * Which of the given actions the caller may see — the fail-closed action-side
 * gate: a caller who cannot see an action learns nothing about what it links to.
 */
async function listVisibleActionIds(
  store: AssetActionLinkStore,
  callerUserId: string,
  actionIds: Iterable<string>,
): Promise<Set<string>> {
  const visible = new Set<string>();
  for (const actionId of new Set(actionIds)) {
    const action = await store.getVisibleGeneralAction({
      callerUserId,
      generalActionId: actionId,
    });
    if (action) {
      visible.add(actionId);
    }
  }
  return visible;
}

/**
 * The linked-asset entry one link row yields for this caller, or null: a durable
 * Asset under its own scope rules, or the caller's own still-pending proposal
 * (flagged `pending`). Dismissed husks never surface.
 */
async function resolveVisibleLinkedAsset(
  store: AssetActionLinkStore,
  callerUserId: string,
  link: GeneralActionAssetLink,
): Promise<GeneralActionLinkedAsset | null> {
  const asset = await loadAnchor(store, callerUserId, link.assetId);
  if (!asset) {
    return null;
  }
  // A pending proposal only ever loads through the caller's own owner-keyed
  // read — a scope-visible read filters to durable statuses (#198).
  const pending = asset.status === "suggested";
  if (!pending && !isDurableAssetStatus(asset.status)) {
    return null;
  }
  return { linkId: link.id, hintLabel: link.hintLabel, asset, pending };
}

/**
 * The linked Assets the caller may see for each given action, keyed by action id
 * (#199). Per-record filtering on both sides: an action id the caller cannot see
 * yields nothing, and each linked asset surfaces only under its own rules.
 */
async function listLinkedAssetsForGeneralActions(
  store: AssetActionLinkStore,
  input: ListLinkedAssetsInput,
): Promise<Record<string, GeneralActionLinkedAsset[]>> {
  const result: Record<string, GeneralActionLinkedAsset[]> = {};
  if (input.generalActionIds.length === 0) {
    return result;
  }
  const links = await store.listGeneralActionAssetLinksForActions({
    generalActionIds: input.generalActionIds,
  });
  const visibleActionIds = await listVisibleActionIds(
    store,
    input.callerUserId,
    links.map((link) => link.generalActionId),
  );

  for (const link of links) {
    if (!visibleActionIds.has(link.generalActionId)) {
      continue;
    }
    const entry = await resolveVisibleLinkedAsset(store, input.callerUserId, link);
    if (!entry) {
      continue;
    }
    const entries = result[link.generalActionId] ?? [];
    entries.push(entry);
    result[link.generalActionId] = entries;
  }
  return result;
}

/**
 * The linked General Actions the caller may see on one Asset — the profile's
 * related-actions read (#199). The asset must itself be durable and visible;
 * each linked action is then filtered independently under the General Action
 * scope rules (review-state actions never surface). Oldest link first.
 */
async function listLinkedGeneralActionsForAsset(
  store: AssetActionLinkStore,
  input: ListLinkedActionsInput,
): Promise<AssetLinkedGeneralAction[]> {
  const asset = await loadAnchor(store, input.callerUserId, input.assetId);
  if (!asset || !isDurableAssetStatus(asset.status)) {
    return [];
  }

  const links = await store.listGeneralActionAssetLinksForAsset({ assetId: input.assetId });
  const linked: AssetLinkedGeneralAction[] = [];
  for (const link of links) {
    const action = await store.getVisibleGeneralAction({
      callerUserId: input.callerUserId,
      generalActionId: link.generalActionId,
    });
    if (!action) {
      continue;
    }
    linked.push({ linkId: link.id, hintLabel: link.hintLabel, action });
  }
  return linked;
}

/**
 * The action↔asset bridge seam (#199): hint promotion and the two linked-record
 * reads, over one composed store. A thin factory over module-scope steps, like
 * `createAssetReview` — web server actions and pages call these thinly.
 */
export function createAssetActionLinks(store: AssetActionLinkStore) {
  return {
    promoteGeneralActionAssetHint: (input: PromoteGeneralActionAssetHintInput) =>
      promoteGeneralActionAssetHint(store, input),
    listLinkedAssetsForGeneralActions: (input: ListLinkedAssetsInput) =>
      listLinkedAssetsForGeneralActions(store, input),
    listLinkedGeneralActionsForAsset: (input: ListLinkedActionsInput) =>
      listLinkedGeneralActionsForAsset(store, input),
    getPromotedFromGeneralAction: (input: { ownerUserId: string; assetId: string }) =>
      getPromotedFromGeneralAction(store, input),
  };
}
