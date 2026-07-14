import {
  type Asset,
  type AssetActionProposalPlan,
  type AssetAuditSource,
  type AssetMemory,
  AssetValidationError,
  type GeneralAction,
  type GeneralActionAssetLink,
  isDurableAssetStatus,
  planAssetMemoryActionProposals,
} from "@tendnote/domain";
import { buildCreateGeneralActionValues } from "../general-actions/attach";
import { makeScheduleGeneralActionEmbedding } from "../general-actions/embed";
import { hydrateGeneralAction } from "../general-actions/hydrate";
import type { GeneralActionLifecycleDeps } from "../general-actions/types";
import type {
  AssetActionProposal,
  AssetActionProposalResult,
  AssetActionProposalStore,
  ListPendingAssetActionProposalsInput,
  PendingAssetActionProposal,
  ProposeAssetMemoryActionsInput,
} from "./action-proposal-types";
import { recordAudit, resolveAssetVisibility } from "./lifecycle";
import { loadAnchor, requireGrounding } from "./review-shared";

/**
 * Asset Memory → Suggested General Action proposals (#203): the write side of the rule
 * in `@tendnote/domain/asset-action-proposals`. A reviewed Asset Memory carrying a
 * warranty date, a renewal date, a maintenance cadence, or a replacement schedule
 * proposes a Suggested General Action — which the owner then accepts, edits, dismisses,
 * or ignores through the *existing* General Action review path (#196 story 40).
 *
 * The load-bearing claim of this module is what it does NOT build. There is no asset
 * reminder system, no asset notification, no asset-side acceptance path, and no second
 * lifecycle: a proposal is an ordinary `suggested` row in `general_actions`, linked to
 * the asset through the same bridge table a promoted hint uses. Acceptance flips that
 * one row in place, so the link never has to move and the action arrives on the Actions
 * ledger, Action Today, the scoped proactive summary, and Asset History with no
 * asset-specific plumbing whatsoever — it is simply a General Action that happens to
 * know which thing it is about.
 *
 * Module-scope steps + a thin factory, like `createAssetReview` and the bridge.
 */

/**
 * The asset a proposal pass may run against: the owner's own, durable, and active.
 *
 * Owner-only, like every review write in this seam — a co-member who can see a
 * household asset may act on its actions, but proposing new review items in someone
 * else's queue is not theirs to do. Archived is refused rather than ignored: a sold car
 * proposing an oil change is precisely the stale noise archive exists to stop.
 */
async function requireProposalAnchor(
  store: AssetActionProposalStore,
  input: { actorUserId: string; assetId: string },
): Promise<Asset> {
  const asset = await store.getAsset({
    ownerUserId: input.actorUserId,
    assetId: input.assetId,
  });
  if (!asset || !isDurableAssetStatus(asset.status)) {
    throw new Error("Asset not found.");
  }
  if (asset.status !== "active") {
    throw new AssetValidationError(
      "This asset is archived — restore it before proposing reminders.",
    );
  }
  return asset;
}

/**
 * The reviewed memories this pass considers, oldest first (the store's ordering
 * contract), optionally narrowed to the ones the caller named. Only `active` memories
 * are loaded: a still-suggested fact has not been accepted as true, and a suggestion
 * must never cascade into a second suggestion downstream of its own review gate.
 */
async function listProposableMemories(
  store: AssetActionProposalStore,
  asset: Asset,
  assetMemoryIds: string[] | undefined,
): Promise<AssetMemory[]> {
  const memories = await store.listAssetMemoriesForOwner({
    ownerUserId: asset.ownerUserId,
    assetId: asset.id,
    statuses: ["active"],
  });
  if (!assetMemoryIds) {
    return memories;
  }
  const wanted = new Set(assetMemoryIds);
  return memories.filter((memory) => wanted.has(memory.id));
}

/**
 * The memory ids that have already had their say, mapped to the action they produced.
 *
 * Idempotency turns on what the owner *did*, and the two rejections mean different
 * things (`general-actions/review.ts`):
 *
 * - `dismissed` is the rejection that sticks. Re-proposing what someone just turned
 *   down is the nag loop the review gate exists to prevent — the same rule action
 *   extraction applies when it refuses to reintroduce a dismissed suggestion.
 * - `ignored` is the quiet set-aside, and the lifecycle's own contract for it is
 *   "propose it again to act on it" — accepting an ignored row throws, so re-proposing
 *   is the *only* way back. Treating it as final would make the profile's set-aside a
 *   one-way door: one misclick and that memory could never remind the owner again.
 *
 * So an ignored proposal is exempt here and its memory becomes proposable afresh; every
 * other prior proposal — pending, accepted, or dismissed — is a memory that has already
 * had its say.
 */
type PriorProposal = {
  linkId: string;
  generalActionId: string;
  /** Set aside, so the memory may propose again — the lifecycle's revival path. */
  revivable: boolean;
};

async function indexPriorProposals(
  store: AssetActionProposalStore,
  ownerUserId: string,
  links: GeneralActionAssetLink[],
): Promise<Map<string, PriorProposal>> {
  const prior = new Map<string, PriorProposal>();
  for (const link of links) {
    if (link.assetMemoryId === null || link.ownerUserId !== ownerUserId) {
      continue;
    }
    const action = await store.getGeneralAction({
      ownerUserId,
      generalActionId: link.generalActionId,
    });
    // A link whose action is gone constrains nothing — the memory may propose again.
    if (!action) {
      continue;
    }
    prior.set(link.assetMemoryId, {
      linkId: link.id,
      generalActionId: action.id,
      revivable: action.status === "ignored",
    });
  }
  return prior;
}

/**
 * The grounding gate for a proposal, and its documented exemption (ADRs 0058, 0151).
 *
 * The memory is already *reviewed* — the owner accepted this fact as true — so reading
 * it back to propose an action is direct user intent, not proactive inference from raw
 * delicate material. The restricted-context check therefore passes as `directlyRequested`,
 * exactly as hint promotion does in the bridge. A memory the owner created themselves
 * carries no source record at all; the explicit act is its own provenance, and the
 * proposal simply records a null grounding.
 */
async function requireProposalGrounding(
  store: AssetActionProposalStore,
  memory: AssetMemory,
): Promise<void> {
  if (memory.sourceRecordId === null) {
    return;
  }
  await requireGrounding(store, {
    ownerUserId: memory.ownerUserId,
    sourceRecordId: memory.sourceRecordId,
    directlyRequested: true,
  });
}

/**
 * The audience a proposal argues: the *memory's* own, never the asset's.
 *
 * This is the child-scope ceiling read in the only direction that matters here. A
 * proposal quotes the memory in its notes ("Warranty expires: 2027-03-14"), so a
 * private detail hanging under a household Asset must produce a private action — if the
 * proposal inherited the asset's household scope, a private fact would leak to
 * co-members through the reminder it inspired.
 */
function resolveProposalVisibility(store: AssetActionProposalStore, memory: AssetMemory) {
  const household = memory.scope === "household";
  return resolveAssetVisibility(store, {
    ownerUserId: memory.ownerUserId,
    scope: household ? "household" : "private",
    householdId: household ? memory.householdId : null,
  });
}

/**
 * Opens one Suggested General Action from a plan: the `suggested` action row, its
 * `suggested` lifecycle event, the asset link carrying the memory provenance, and the
 * `action_proposed` entry in the asset's audit trail.
 *
 * The action is born through the shared `buildCreateGeneralActionValues` builder so its
 * defaults can never drift from a proposal made anywhere else, and its status is
 * `suggested` — the one status every scope-visible read and every proactive surface
 * filters out. It reaches nothing until the owner accepts it.
 */
async function openProposedAction(
  store: AssetActionProposalStore,
  input: {
    asset: Asset;
    memory: AssetMemory;
    plan: AssetActionProposalPlan;
    actorUserId: string;
    source: NonNullable<ProposeAssetMemoryActionsInput["source"]>;
  },
): Promise<GeneralAction> {
  const { asset, memory, plan } = input;
  const { scope, householdId } = await resolveProposalVisibility(store, memory);

  const action = await store.createGeneralAction(
    buildCreateGeneralActionValues(
      {
        ownerUserId: memory.ownerUserId,
        title: plan.title,
        notes: plan.notes,
        dueAt: plan.dueAt,
        recurrence: plan.recurrence,
      },
      {
        status: "suggested",
        sourceRecordId: memory.sourceRecordId,
        areaId: null,
        scope,
        householdId,
      },
    ),
  );

  await store.createGeneralActionEvent({
    generalActionId: action.id,
    ownerUserId: action.ownerUserId,
    kind: "suggested",
    actorUserId: input.actorUserId,
    detailJson: {
      scope: action.scope,
      grounded: memory.sourceRecordId !== null,
      filed: false,
      peopleLinked: 0,
      recurring: action.recurrence !== null,
      // What makes this proposal explainable on the action side, too.
      fromAssetMemory: true,
      assetId: asset.id,
      assetMemoryId: memory.id,
      reason: plan.reason,
    },
  });

  await store.createGeneralActionAssetLink({
    ownerUserId: memory.ownerUserId,
    generalActionId: action.id,
    assetId: asset.id,
    hintLabel: null,
    assetMemoryId: memory.id,
  });

  await recordAudit(store, asset, {
    kind: "action_proposed",
    actorUserId: input.actorUserId,
    source: input.source,
    detail: {
      generalActionId: action.id,
      assetMemoryId: memory.id,
      memoryLabel: memory.label,
      reason: plan.reason,
      scope: action.scope,
      recurring: action.recurrence !== null,
    },
  });

  return action;
}

/** The memories a pass may still plan over, and the set-aside husks it will clear. */
type ProposableSelection = {
  memories: AssetMemory[];
  /** memory id → the ignored proposal's link row, cleared as the memory proposes again. */
  staleLinkByMemory: Map<string, string>;
};

/**
 * Narrows the asset's reviewed memories to the ones that may still speak: those with no
 * prior proposal, plus those whose proposal was set aside (revivable). Planning then runs
 * over only these, so a memory that already proposed can never consume the pass's cap and
 * crowd out a fresh one.
 */
function selectProposableMemories(
  memories: AssetMemory[],
  prior: Map<string, PriorProposal>,
): ProposableSelection {
  const selection: ProposableSelection = { memories: [], staleLinkByMemory: new Map() };
  for (const memory of memories) {
    const previous = prior.get(memory.id);
    if (previous && !previous.revivable) {
      continue;
    }
    if (previous) {
      selection.staleLinkByMemory.set(memory.id, previous.linkId);
    }
    selection.memories.push(memory);
  }
  return selection;
}

/**
 * Writes one planned proposal: clears the set-aside husk it replaces (so one memory keeps
 * exactly one link and the profile never shows a detail proposing twice), opens the
 * `suggested` action, and embeds it.
 *
 * The embedding is the same embed-on-write `suggestGeneralAction` performs: a proposal is
 * embedded when suggested so it is findable in owner-only review context (ADR 0150, #184).
 * Skipping it would leave asset-derived proposals — and only those — invisible to recall
 * while they sit pending.
 */
async function openProposalFromPlan(
  store: AssetActionProposalStore,
  scheduleActionEmbedding: (action: GeneralAction) => Promise<void>,
  input: {
    asset: Asset;
    memory: AssetMemory;
    plan: AssetActionProposalPlan;
    staleLinkId: string | undefined;
    actorUserId: string;
    source: AssetAuditSource;
  },
): Promise<AssetActionProposal> {
  const { asset, memory, plan } = input;
  await requireProposalGrounding(store, memory);

  if (input.staleLinkId) {
    await store.deleteGeneralActionAssetLink({
      ownerUserId: memory.ownerUserId,
      linkId: input.staleLinkId,
    });
  }

  const action = await openProposedAction(store, {
    asset,
    memory,
    plan,
    actorUserId: input.actorUserId,
    source: input.source,
  });
  await scheduleActionEmbedding(action);

  return {
    reason: plan.reason,
    assetMemoryId: memory.id,
    action: await hydrateGeneralAction(store, action),
  };
}

/**
 * Proposes Suggested General Actions from an Asset's reviewed memories (#203).
 *
 * One pass, capped by the domain planner, idempotent per memory: a memory that has
 * already had its say — pending, accepted, or dismissed — is skipped, while one whose
 * proposal was *ignored* is revived (see {@link indexPriorProposals}). Nothing here can
 * create an active action; every proposal lands in review.
 *
 * The pass is deliberately not transactional. Idempotency is what makes that safe: a
 * partial pass leaves each completed proposal correctly linked, and the next pass simply
 * picks up the memories that never got one — a retry can never double-propose.
 */
async function proposeAssetMemoryActions(
  store: AssetActionProposalStore,
  scheduleActionEmbedding: (action: GeneralAction) => Promise<void>,
  input: ProposeAssetMemoryActionsInput,
): Promise<AssetActionProposalResult> {
  const asset = await requireProposalAnchor(store, input);
  const now = input.now ?? new Date();
  const source = input.source ?? "user";

  const reviewed = await listProposableMemories(store, asset, input.assetMemoryIds);
  const links = await store.listGeneralActionAssetLinksForAsset({ assetId: asset.id });
  const prior = await indexPriorProposals(store, asset.ownerUserId, links);
  const { memories, staleLinkByMemory } = selectProposableMemories(reviewed, prior);

  const plans = planAssetMemoryActionProposals({ asset, memories, now });
  const memoriesById = new Map(memories.map((memory) => [memory.id, memory]));

  const result: AssetActionProposalResult = { asset, proposed: [] };
  for (const plan of plans) {
    const memory = memoriesById.get(plan.assetMemoryId);
    if (!memory) {
      continue;
    }
    result.proposed.push(
      await openProposalFromPlan(store, scheduleActionEmbedding, {
        asset,
        memory,
        plan,
        staleLinkId: staleLinkByMemory.get(memory.id),
        actorUserId: input.actorUserId,
        source,
      }),
    );
  }

  return result;
}

/**
 * The pending proposal one link row yields for this owner, or null. A link only counts
 * when it carries memory provenance, belongs to the owner, still points at a `suggested`
 * action, and its memory still exists — anything else has moved on: an accepted proposal
 * is now a durable linked action, a dismissed one is resolved, and a deleted memory took
 * its provenance with it. Fail-closed by returning null rather than a partial row.
 */
async function resolvePendingProposal(
  store: AssetActionProposalStore,
  ownerUserId: string,
  link: GeneralActionAssetLink,
): Promise<PendingAssetActionProposal | null> {
  if (link.assetMemoryId === null || link.ownerUserId !== ownerUserId) {
    return null;
  }
  const action = await store.getGeneralAction({
    ownerUserId,
    generalActionId: link.generalActionId,
  });
  if (action?.status !== "suggested") {
    return null;
  }
  const memory = await store.getAssetMemory({ ownerUserId, memoryId: link.assetMemoryId });
  if (!memory) {
    return null;
  }
  return {
    assetMemoryId: memory.id,
    memoryLabel: memory.label,
    action: await hydrateGeneralAction(store, action),
  };
}

/**
 * The owner's still-suggested asset-derived actions for one Asset — what the Asset
 * Profile renders as pending proposals, each paired with the memory that argued for it.
 *
 * Owner-only: review state is never a co-member's to see, so a caller who is not the
 * asset's owner reads an empty list rather than a denial.
 */
async function listPendingAssetActionProposals(
  store: AssetActionProposalStore,
  input: ListPendingAssetActionProposalsInput,
): Promise<PendingAssetActionProposal[]> {
  const asset = await loadAnchor(store, input.actorUserId, input.assetId);
  if (!asset || !isDurableAssetStatus(asset.status) || asset.ownerUserId !== input.actorUserId) {
    return [];
  }

  const links = await store.listGeneralActionAssetLinksForAsset({ assetId: asset.id });
  const pending: PendingAssetActionProposal[] = [];
  for (const link of links) {
    const proposal = await resolvePendingProposal(store, input.actorUserId, link);
    if (proposal) {
      pending.push(proposal);
    }
  }
  return pending;
}

/**
 * The asset→action proposal seam (#203): generation and the owner's pending-proposal
 * read, over one composed store. A thin factory over module-scope steps, like
 * `createAssetActionLinks` — web server actions, the Asset Profile, and the Eve tool
 * all call these thinly.
 *
 * `deps` carries the same embed-on-write scheduler the General Action lifecycle and
 * review seams take, so a proposal born here is embedded exactly as one born through
 * `suggestGeneralAction`. It defaults to a no-op, so stores and tests that do not
 * exercise retrieval need not wire it.
 */
export function createAssetActionProposals(
  store: AssetActionProposalStore,
  deps: GeneralActionLifecycleDeps = {},
) {
  const scheduleActionEmbedding = makeScheduleGeneralActionEmbedding(deps);

  return {
    proposeAssetMemoryActions: (input: ProposeAssetMemoryActionsInput) =>
      proposeAssetMemoryActions(store, scheduleActionEmbedding, input),
    listPendingAssetActionProposals: (input: ListPendingAssetActionProposalsInput) =>
      listPendingAssetActionProposals(store, input),
  };
}
