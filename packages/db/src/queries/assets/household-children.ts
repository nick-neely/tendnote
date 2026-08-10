import type { AssetEvidence, AssetMemory } from "@tendnote/domain";
import {
  ASSET_STALE_WRITE_MESSAGE,
  AssetValidationError,
  assertAssetRecordFresh,
  assetMemoryEditSchema,
  HouseholdRecordUnavailableError,
  resolveAssetMemoryContentPatch,
} from "@tendnote/domain";
import {
  type AssetChildFacts,
  createAssetAuthority,
  resolveOwnedOrVisible,
} from "./household-authority";
import { recordAudit } from "./lifecycle";
import { loadAnchor } from "./review-shared";
import type {
  AssetMemoryActionInput,
  AssetReviewLifecycleStore,
  EditAssetMemoryInput,
} from "./review-types";

/**
 * Maintaining the details already hanging off an Asset — reading them under the
 * proof, correcting them, and setting them aside — for both ownership forms.
 *
 * Separate from `review-*.ts` on purpose. Those modules are about a *proposal*
 * becoming truth, and every one of them is owner-only by construction because a
 * suggestion belongs to the member it was suggested to. These are about a detail
 * that is already true, where the household's own facts are everybody's to keep
 * accurate and one member's are still only theirs (#386, ADR 0214).
 */

/** The facts a memory presents to the proof — never its label, value, or notes. */
function memoryFacts(memory: AssetMemory): AssetChildFacts {
  return {
    kind: "asset_memory",
    id: memory.id,
    ownerUserId: memory.ownerUserId,
    scope: memory.scope,
    ownership: memory.ownership,
    householdId: memory.householdId,
  };
}

/** The same for evidence. */
function evidenceFacts(evidence: AssetEvidence): AssetChildFacts {
  return {
    kind: "asset_evidence",
    id: evidence.id,
    ownerUserId: evidence.ownerUserId,
    scope: evidence.scope,
    ownership: evidence.ownership,
    householdId: evidence.householdId,
  };
}

/**
 * Loads the detail the acting member is talking about, whichever form it takes.
 *
 * The owner-keyed read is accepted only for a member-owned row — the storage-key
 * rule again, applied one level down: a household-native detail's `ownerUserId`
 * is whoever typed it, and reading it as an access path would leave a departed
 * member correcting the household's filter size (ADR 0214).
 */
async function loadMemory(
  store: AssetReviewLifecycleStore,
  input: AssetMemoryActionInput,
  options: { includeSetAside?: boolean } = {},
): Promise<AssetMemory> {
  const visible = await resolveOwnedOrVisible({
    owned: () => store.getAssetMemory({ ownerUserId: input.actorUserId, memoryId: input.memoryId }),
    visible: () =>
      store.getVisibleAssetMemory({
        callerUserId: input.actorUserId,
        memoryId: input.memoryId,
        includeSetAside: options.includeSetAside,
      }),
  });
  // The same sentence a refused proof produces: "no such detail", "you may
  // not", and "you were removed from that household" are indistinguishable.
  if (!visible) {
    throw new HouseholdRecordUnavailableError();
  }
  return visible;
}

/**
 * Corrects a durable, active Asset Memory in place.
 *
 * The owner of a member-owned detail, or any active member of a household-native
 * one — and on a stale write the member keeps their draft and is told what is
 * there now, rather than silently overwriting a correction someone else just
 * made.
 */
export async function editAssetMemory(
  store: AssetReviewLifecycleStore,
  input: EditAssetMemoryInput,
): Promise<AssetMemory> {
  // Loaded including a set-aside detail so the race below answers plainly
  // instead of opaquely. Someone else setting this aside while the member was
  // typing is not a protected fact — they were looking at the record a moment
  // ago — and "that's no longer available" would be true, unhelpful, and
  // different depending on the ownership form, since only the household-native
  // arm would have fallen through the active-only read.
  const memory = await loadMemory(store, input, { includeSetAside: true });
  // Authority first, so all three maintenance paths read the same way and no
  // lifecycle message is ever answered to a caller who may not act at all.
  await createAssetAuthority(store).requireAssetChildAuthority({
    actorUserId: input.actorUserId,
    child: memoryFacts(memory),
    operation: "edit",
  });
  if (memory.status === "dismissed") {
    throw new AssetValidationError(
      "This detail was set aside while you were editing. Bring it back first.",
    );
  }
  if (memory.status !== "active") {
    // A proposal is corrected through review, where accepting it is the same
    // gesture. Sending it down this path would let an edit resolve a suggestion
    // without anyone having reviewed it.
    throw new AssetValidationError("Only a detail that's been kept can be corrected.");
  }
  assertAssetRecordFresh({
    expectedRevision: input.expectedRevision,
    current: memory,
    currentValue: memory.label,
    message: ASSET_STALE_WRITE_MESSAGE,
  });

  const updated = await store.updateAssetMemory({
    ownerUserId: memory.ownerUserId,
    memoryId: memory.id,
    patch: {
      ...resolveAssetMemoryContentPatch(memory, assetMemoryEditSchema.parse(input.edit)),
      lastActorUserId: input.actorUserId,
    },
  });

  const anchor = await loadAnchor(store, memory.ownerUserId, memory.assetId);
  if (anchor) {
    await recordAudit(store, anchor, {
      kind: "memory_edited",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { memoryId: updated.id, label: updated.label, ownership: updated.ownership },
    });
  }
  return updated;
}

/**
 * Sets aside a durable, active Asset Memory — the removal path for a detail that
 * turned out to be wrong or no longer applies.
 *
 * It reuses the `dismissed` state a rejected suggestion lands in rather than
 * inventing a second one: both mean "not a fact about this Asset any more", and
 * a memory with two ways of not being true would need two ways of reading it
 * back. Nothing is deleted, so a household-native detail stays with the
 * workspace and its history stays intact (ADR 0214).
 */
export async function setAsideAssetMemory(
  store: AssetReviewLifecycleStore,
  input: AssetMemoryActionInput & { source?: AssetMemoryAuditSource },
): Promise<AssetMemory> {
  // Same widening as the correction path, for the same reason: two members
  // setting the same detail aside is a race that settles, not a refusal.
  const memory = await loadMemory(store, input, { includeSetAside: true });
  // Authority first, before any settling. An idempotent early return that runs
  // ahead of the proof answers a caller who has no standing to ask — and hands
  // them the record while doing it.
  await createAssetAuthority(store).requireAssetChildAuthority({
    actorUserId: input.actorUserId,
    child: memoryFacts(memory),
    operation: "remove",
  });
  if (memory.status === "dismissed") {
    // Someone got there first, and the state the member wanted is the state the
    // record is in.
    return memory;
  }
  if (memory.status !== "active") {
    throw new AssetValidationError("Only a detail that's been kept can be set aside.");
  }

  const updated = await store.updateAssetMemory({
    ownerUserId: memory.ownerUserId,
    memoryId: memory.id,
    patch: { status: "dismissed", lastActorUserId: input.actorUserId },
  });

  const anchor = await loadAnchor(store, memory.ownerUserId, memory.assetId);
  if (anchor) {
    await recordAudit(store, anchor, {
      kind: "memory_dismissed",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { memoryId: updated.id, label: updated.label, cascade: false },
    });
  }
  return updated;
}

/**
 * Brings a set-aside detail back — the inverse behind the undo the surface
 * offers for the five seconds after a set-aside, and a first-class path
 * afterwards rather than a hidden one.
 *
 * The same authority as setting it aside, because they are one decision in two
 * directions. Reusing the `dismissed` → `active` transition means the record
 * never left: a household-native detail brought back is the same row, with the
 * same history, and the trail records who set it aside and who restored it.
 */
export async function restoreAssetMemory(
  store: AssetReviewLifecycleStore,
  input: AssetMemoryActionInput & { source?: AssetMemoryAuditSource },
): Promise<AssetMemory> {
  const memory = await loadMemory(store, input, { includeSetAside: true });
  // Authority before settling, for the same reason as above.
  await createAssetAuthority(store).requireAssetChildAuthority({
    actorUserId: input.actorUserId,
    child: memoryFacts(memory),
    operation: "remove",
  });
  if (memory.status === "active") {
    // Idempotent rather than an error: an undo that arrives twice — a double
    // click, a retried request — should settle on the state the member wanted.
    return memory;
  }
  if (memory.status !== "dismissed") {
    throw new AssetValidationError("Only a detail that's been set aside can be brought back.");
  }

  const updated = await store.updateAssetMemory({
    ownerUserId: memory.ownerUserId,
    memoryId: memory.id,
    patch: { status: "active", lastActorUserId: input.actorUserId },
  });

  const anchor = await loadAnchor(store, memory.ownerUserId, memory.assetId);
  if (anchor) {
    await recordAudit(store, anchor, {
      kind: "memory_restored",
      actorUserId: input.actorUserId,
      source: input.source ?? "user",
      detail: { memoryId: updated.id, label: updated.label },
    });
  }
  return updated;
}

type AssetMemoryAuditSource = Parameters<typeof recordAudit>[2]["source"];

/**
 * The active Asset Memories on one Asset the caller may actually be shown.
 *
 * The store's per-record scope predicate narrows the query; the proof then
 * re-decides each row on its own facts, read now. This is the composed-child
 * read path ADR 0219 deferred to this issue: a visible parent carries nothing
 * through it, so the household's refrigerator being open to everyone still says
 * nothing about the private note hanging off it (ADR 0179).
 */
export async function listVisibleAssetMemories(
  store: AssetReviewLifecycleStore,
  input: { callerUserId: string; assetId: string },
): Promise<AssetMemory[]> {
  const memories = await store.listVisibleAssetMemoriesForAsset(input);
  return createAssetAuthority(store).keepProvenChildren({
    callerUserId: input.callerUserId,
    rows: memories,
    facts: memoryFacts,
  });
}

/** The same two-gate read for the evidence on one Asset. */
export async function listVisibleAssetEvidence(
  store: AssetReviewLifecycleStore,
  input: { callerUserId: string; assetId: string },
): Promise<AssetEvidence[]> {
  const evidence = await store.listVisibleAssetEvidenceForAsset(input);
  return createAssetAuthority(store).keepProvenChildren({
    callerUserId: input.callerUserId,
    rows: evidence,
    facts: evidenceFacts,
  });
}

/**
 * The gated file read behind every evidence download or preview, re-proved.
 *
 * A deep link to bytes is exactly the path ADR 0219 names: the url outlives the
 * page that produced it, so standing is re-read here rather than inherited from
 * whatever render first offered the link.
 */
export async function proveVisibleEvidence(
  store: AssetReviewLifecycleStore,
  input: { callerUserId: string; evidence: AssetEvidence },
): Promise<AssetEvidence | null> {
  const [kept] = await createAssetAuthority(store).keepProvenChildren({
    callerUserId: input.callerUserId,
    rows: [input.evidence],
    facts: evidenceFacts,
  });
  return kept ?? null;
}
