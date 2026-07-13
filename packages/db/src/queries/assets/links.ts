import {
  type Asset,
  type AssetLink,
  type AssetPersonLink,
  AssetValidationError,
  isDurableAssetStatus,
  requireLinkableAssetPair,
  resolveAssetLinkPerspective,
} from "@tendnote/domain";
import { recordAudit } from "./lifecycle";
import type {
  AddAssetLinkInput,
  AddAssetPersonLinkInput,
  AssetContextLinkStore,
  AssetLinkActionInput,
  AssetPersonLinkEntry,
  ListAssetContextInput,
  RelatedAssetLink,
  SuggestAssetLinkInput,
} from "./link-types";
import { loadAnchor, requireActiveAnchor, requireGrounding } from "./review-shared";

/**
 * The lightweight Related Asset Link seam (#202): explicit link CRUD between two
 * Assets with the small fixed relation set. Module-scope steps + a thin factory,
 * like the rest of the asset seams. A link is context, not ownership: it carries
 * no scope of its own, and each read filters both sides per record — a link
 * surfaces only where the caller can already see both assets.
 */

/** Loads a durable asset the caller may see, or throws the deterministic denial. */
async function requireVisibleDurableAsset(
  store: AssetContextLinkStore,
  callerUserId: string,
  assetId: string,
): Promise<Asset> {
  const asset = await loadAnchor(store, callerUserId, assetId);
  if (!asset || !isDurableAssetStatus(asset.status)) {
    throw new Error("Asset not found.");
  }
  return asset;
}

/**
 * Loads and validates the two ends of a link write: distinct assets, both
 * visible to the actor, the subject still active (the shared active-anchor rule
 * from `review-shared`, same as memory and evidence writes). The object may be
 * archived — a new asset legitimately `replaces` a retired one.
 */
async function requireLinkableAssets(
  store: AssetContextLinkStore,
  input: { actorUserId: string; fromAssetId: string; toAssetId: string },
): Promise<{ fromAsset: Asset; toAsset: Asset }> {
  requireLinkableAssetPair(input.fromAssetId, input.toAssetId);
  const fromAsset = await requireActiveAnchor(store, input.actorUserId, input.fromAssetId);
  const toAsset = await requireVisibleDurableAsset(store, input.actorUserId, input.toAssetId);
  return { fromAsset, toAsset };
}

/**
 * Creates an active Related Asset Link from explicit user intent (#202).
 * Idempotent per owner-scoped (owner, from, to, relation) triple: the actor's
 * *own* pending suggestion or dismissed husk of the same link resolves to
 * active in place — the user just asked for it, which is exactly what review
 * would have confirmed. A co-member's same-shaped link is a different record
 * entirely: their review stays theirs (a member's add never resolves it) and
 * their dismissal stays declined (never revived by someone else's add) — the
 * actor simply gets their own row, and reads dedupe per caller.
 */
async function addAssetLink(
  store: AssetContextLinkStore,
  input: AddAssetLinkInput,
): Promise<AssetLink> {
  const { fromAsset } = await requireLinkableAssets(store, input);

  const link = await store.createAssetLink({
    ownerUserId: input.actorUserId,
    fromAssetId: input.fromAssetId,
    toAssetId: input.toAssetId,
    relation: input.relation,
    status: "active",
    sourceRecordId: null,
  });
  if (link.status === "active") {
    // Freshly created, or an already-active link returned idempotently. Audit
    // only the fresh write: an idempotent re-add changed nothing... but the two
    // are indistinguishable here, and a duplicate `link_added` in an internal
    // trail is harmless — prefer never missing a write.
    await recordAudit(store, fromAsset, {
      kind: "link_added",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { linkId: link.id, toAssetId: link.toAssetId, relation: link.relation },
    });
    return link;
  }

  // The actor's own triple already exists as a suggestion or dismissed husk —
  // their explicit add resolves it to active in place. Owner-safe by
  // construction: the unique triple is owner-scoped, so `createAssetLink` can
  // only ever have returned the actor's own row — a co-member's link, pending
  // review, or remembered dismissal is unreachable from here (link review and
  // removal stay owner-only).
  const promoted = await store.updateAssetLink({
    ownerUserId: link.ownerUserId,
    linkId: link.id,
    patch: { status: "active" },
  });
  await recordAudit(store, fromAsset, {
    kind: "link_promoted",
    actorUserId: input.actorUserId,
    source: input.source ?? "user",
    detail: {
      linkId: promoted.id,
      toAssetId: promoted.toAssetId,
      relation: promoted.relation,
      explicit: true,
    },
  });
  return promoted;
}

/**
 * Proposes an inferred Related Asset Link (#202): persisted `suggested` —
 * owner-only, review-gated (ADR 0151) — until the owner accepts, dismisses, or
 * explicitly adds it. Grounding is mandatory, and restricted context never
 * feeds a proactive proposal unless the user asked directly (ADR 0058).
 * Idempotent per triple, and quiet about the past: an already-active link
 * returns as-is, and a dismissed husk stays dismissed — inference never re-nags
 * about a link the user already declined.
 */
async function suggestAssetLink(
  store: AssetContextLinkStore,
  input: SuggestAssetLinkInput,
): Promise<AssetLink> {
  const { fromAsset } = await requireLinkableAssets(store, {
    actorUserId: input.ownerUserId,
    fromAssetId: input.fromAssetId,
    toAssetId: input.toAssetId,
  });
  await requireGrounding(store, {
    ownerUserId: input.ownerUserId,
    sourceRecordId: input.sourceRecordId,
    directlyRequested: input.directlyRequested,
  });

  const link = await store.createAssetLink({
    ownerUserId: input.ownerUserId,
    fromAssetId: input.fromAssetId,
    toAssetId: input.toAssetId,
    relation: input.relation,
    status: "suggested",
    sourceRecordId: input.sourceRecordId,
  });
  if (link.status !== "suggested") {
    // The triple already exists (active, or a remembered dismissal) — return it
    // unchanged rather than re-proposing.
    return link;
  }

  await recordAudit(store, fromAsset, {
    kind: "link_suggested",
    actorUserId: input.ownerUserId,
    source: input.source ?? "assistant",
    detail: { linkId: link.id, toAssetId: link.toAssetId, relation: link.relation, grounded: true },
  });
  return link;
}

/** Owner-keyed load of a still-pending suggested link, with curated refusals. */
async function requireSuggestedLink(
  store: AssetContextLinkStore,
  input: AssetLinkActionInput,
): Promise<AssetLink> {
  const link = await store.getAssetLink({
    ownerUserId: input.actorUserId,
    linkId: input.linkId,
  });
  if (!link) {
    throw new Error("Asset link not found.");
  }
  if (link.status !== "suggested") {
    throw new AssetValidationError("Only a suggested link can be reviewed.");
  }
  return link;
}

/** Accepts a suggested link in place — the same row simply becomes durable. */
async function acceptSuggestedAssetLink(
  store: AssetContextLinkStore,
  input: AssetLinkActionInput,
): Promise<AssetLink> {
  const link = await requireSuggestedLink(store, input);
  const accepted = await store.updateAssetLink({
    ownerUserId: link.ownerUserId,
    linkId: link.id,
    patch: { status: "active" },
  });
  const fromAsset = await loadAnchor(store, input.actorUserId, link.fromAssetId);
  if (fromAsset) {
    await recordAudit(store, fromAsset, {
      kind: "link_promoted",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { linkId: link.id, toAssetId: link.toAssetId, relation: link.relation },
    });
  }
  return accepted;
}

/** Dismisses a suggested link into a quiet husk — remembered, never re-proposed. */
async function dismissSuggestedAssetLink(
  store: AssetContextLinkStore,
  input: AssetLinkActionInput,
): Promise<void> {
  const link = await requireSuggestedLink(store, input);
  await store.updateAssetLink({
    ownerUserId: link.ownerUserId,
    linkId: link.id,
    patch: { status: "dismissed" },
  });
  const fromAsset = await loadAnchor(store, input.actorUserId, link.fromAssetId);
  if (fromAsset) {
    await recordAudit(store, fromAsset, {
      kind: "link_dismissed",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { linkId: link.id, toAssetId: link.toAssetId, relation: link.relation },
    });
  }
}

/**
 * The profile entry one link row yields for this caller, or null: an active
 * link whose other end the caller can also see (fail-closed — an invisible
 * asset's existence never leaks through a link row), or the caller's own
 * still-pending suggestion (flagged `pending`). Dismissed husks never surface.
 */
async function resolveRelatedAssetLink(
  store: AssetContextLinkStore,
  input: ListAssetContextInput,
  link: AssetLink,
): Promise<RelatedAssetLink | null> {
  if (link.status === "dismissed") {
    return null;
  }
  if (link.status === "suggested" && link.ownerUserId !== input.callerUserId) {
    return null;
  }
  const perspective = resolveAssetLinkPerspective(link, input.assetId);
  if (!perspective) {
    return null;
  }
  const otherAsset = await loadAnchor(store, input.callerUserId, perspective.otherAssetId);
  if (!otherAsset || !isDurableAssetStatus(otherAsset.status)) {
    return null;
  }
  return {
    linkId: link.id,
    relation: link.relation,
    direction: perspective.direction,
    otherAsset,
    pending: link.status === "suggested",
    owned: link.ownerUserId === input.callerUserId,
  };
}

/**
 * The Related Asset Links one profile may show this caller (#202): the asset
 * itself must be visible and durable; each link then surfaces only under
 * `resolveRelatedAssetLink`'s per-record gates for both sides. The unique
 * triple is owner-scoped, so two household members may each hold the same
 * relationship — reads dedupe per (from, to, relation), preferring the
 * caller's own row so their remove and review controls always work.
 */
async function listRelatedAssetLinks(
  store: AssetContextLinkStore,
  input: ListAssetContextInput,
): Promise<RelatedAssetLink[]> {
  const asset = await loadAnchor(store, input.callerUserId, input.assetId);
  if (!asset || !isDurableAssetStatus(asset.status)) {
    return [];
  }

  const rows = await store.listAssetLinksForAsset({ assetId: input.assetId });
  const byTriple = new Map<string, RelatedAssetLink>();
  for (const link of rows) {
    const entry = await resolveRelatedAssetLink(store, input, link);
    if (!entry) {
      continue;
    }
    const triple = `${link.fromAssetId}|${link.toAssetId}|${link.relation}`;
    const existing = byTriple.get(triple);
    if (!existing || (!existing.owned && entry.owned)) {
      byTriple.set(triple, entry);
    }
  }
  return [...byTriple.values()];
}

/** Owner-keyed load of a link, or the deterministic denial. */
async function requireOwnedLink(
  store: AssetContextLinkStore,
  input: AssetLinkActionInput,
): Promise<AssetLink> {
  const link = await store.getAssetLink({
    ownerUserId: input.actorUserId,
    linkId: input.linkId,
  });
  if (!link) {
    throw new Error("Asset link not found.");
  }
  return link;
}

/**
 * Removes a Related Asset Link. Owner-only: the link belongs to whoever created
 * it — a member who can see both assets still cannot unlink someone else's
 * context (fail closed, ADR 0153).
 */
async function removeAssetLink(
  store: AssetContextLinkStore,
  input: AssetLinkActionInput,
): Promise<void> {
  const link = await requireOwnedLink(store, input);
  await store.deleteAssetLink({ ownerUserId: link.ownerUserId, linkId: link.id });
  const fromAsset = await loadAnchor(store, input.actorUserId, link.fromAssetId);
  if (fromAsset) {
    await recordAudit(store, fromAsset, {
      kind: "link_removed",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { linkId: link.id, toAssetId: link.toAssetId, relation: link.relation },
    });
  }
}

/**
 * Links one of the caller's own people to a visible asset as context (#202):
 * who borrowed, recommended, uses, stores, services, or knows about it. The
 * person must be the caller's — people are owner-private records — and the
 * link never confers ownership or visibility on either side. Explicit-only in
 * this slice, an active asset required (the shared active-anchor rule),
 * idempotent per owner-scoped (owner, asset, person, relation) triple.
 */
async function addAssetPersonLink(
  store: AssetContextLinkStore,
  input: AddAssetPersonLinkInput,
): Promise<AssetPersonLink> {
  const asset = await requireActiveAnchor(store, input.actorUserId, input.assetId);
  const person = await store.getPerson({
    ownerUserId: input.actorUserId,
    personId: input.personId,
  });
  if (!person) {
    throw new Error("Person not found.");
  }

  const link = await store.createAssetPersonLink({
    ownerUserId: input.actorUserId,
    assetId: input.assetId,
    personId: input.personId,
    relation: input.relation,
  });
  await recordAudit(store, asset, {
    kind: "person_link_added",
    actorUserId: input.actorUserId,
    source: input.source ?? "user",
    detail: { linkId: link.id, personId: link.personId, relation: link.relation },
  });
  return link;
}

/**
 * The Asset Person Links one profile may show this caller (#202): only the
 * caller's own links — a person is theirs alone, so a household member never
 * reads another member's people through a shared asset — each named through the
 * caller's own person record. A link whose person has since been deleted is
 * skipped rather than rendered nameless.
 */
async function listAssetPersonLinks(
  store: AssetContextLinkStore,
  input: ListAssetContextInput,
): Promise<AssetPersonLinkEntry[]> {
  const asset = await loadAnchor(store, input.callerUserId, input.assetId);
  if (!asset || !isDurableAssetStatus(asset.status)) {
    return [];
  }

  const rows = await store.listAssetPersonLinksForAsset({ assetId: input.assetId });
  const entries: AssetPersonLinkEntry[] = [];
  for (const link of rows) {
    if (link.ownerUserId !== input.callerUserId) {
      continue;
    }
    const person = await store.getPerson({
      ownerUserId: input.callerUserId,
      personId: link.personId,
    });
    if (!person) {
      continue;
    }
    entries.push({
      linkId: link.id,
      relation: link.relation,
      person: { id: person.id, displayName: person.displayName },
    });
  }
  return entries;
}

/** Removes the caller's own person link, fail-closed, and audits the removal. */
async function removeAssetPersonLink(
  store: AssetContextLinkStore,
  input: AssetLinkActionInput,
): Promise<void> {
  const link = await store.getAssetPersonLink({
    ownerUserId: input.actorUserId,
    linkId: input.linkId,
  });
  if (!link) {
    throw new Error("Asset person link not found.");
  }
  await store.deleteAssetPersonLink({ ownerUserId: link.ownerUserId, linkId: link.id });
  const asset = await loadAnchor(store, input.actorUserId, link.assetId);
  if (asset) {
    await recordAudit(store, asset, {
      kind: "person_link_removed",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { linkId: link.id, personId: link.personId, relation: link.relation },
    });
  }
}

/**
 * The profile-context link seam (#202): Related Asset Links and Asset Person
 * Links over one composed store. A thin factory over module-scope steps, like
 * `createAssetReview` — web server actions and pages call these thinly.
 */
export function createAssetContextLinks(store: AssetContextLinkStore) {
  return {
    addAssetLink: (input: AddAssetLinkInput) => addAssetLink(store, input),
    suggestAssetLink: (input: SuggestAssetLinkInput) => suggestAssetLink(store, input),
    acceptSuggestedAssetLink: (input: AssetLinkActionInput) =>
      acceptSuggestedAssetLink(store, input),
    dismissSuggestedAssetLink: (input: AssetLinkActionInput) =>
      dismissSuggestedAssetLink(store, input),
    listRelatedAssetLinks: (input: ListAssetContextInput) => listRelatedAssetLinks(store, input),
    removeAssetLink: (input: AssetLinkActionInput) => removeAssetLink(store, input),
    addAssetPersonLink: (input: AddAssetPersonLinkInput) => addAssetPersonLink(store, input),
    listAssetPersonLinks: (input: ListAssetContextInput) => listAssetPersonLinks(store, input),
    removeAssetPersonLink: (input: AssetLinkActionInput) => removeAssetPersonLink(store, input),
  };
}
