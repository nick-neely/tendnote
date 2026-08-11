import {
  ASSET_STALE_WRITE_MESSAGE,
  type Asset,
  type AssetAuditEventKind,
  type AssetAuditSource,
  type AssetAuthorityOperation,
  AssetValidationError,
  assertAssetEditable,
  assertAssetRecordFresh,
  assetEditSchema,
  HouseholdRecordUnavailableError,
  isDurableAssetStatus,
  isEmptyAssetEdit,
  type PrivacyScope,
  resolveAssetTransition,
} from "@tendnote/domain";
import { resolveRecordVisibility } from "../households/record-visibility";
import { type AssetEmbeddingDeps, makeScheduleAssetEmbedding } from "./embed";
import { createAssetAuthority, resolveOwnedOrVisible } from "./household-authority";
import type {
  AssetActionInput,
  AssetLifecycleStore,
  AssetPatch,
  AssetWithContext,
  CreateActiveAssetInput,
  EditAssetInput,
  ListAssetAuditInput,
  ListAssetsInput,
} from "./types";

/**
 * Validates and normalizes an Asset's visibility choice through the shared
 * record-visibility guard (the same rules General Actions apply), with asset
 * wording and the asset validation error type (ADR 0153). Shared with the review
 * lifecycle (#198) so a proposal's argued scope and an accept-time audience
 * resolve through the exact same rules.
 */
export async function resolveAssetVisibility(
  store: AssetLifecycleStore,
  input: {
    ownerUserId: string;
    scope?: PrivacyScope;
    householdId?: string | null;
    selectedUserIds?: string[];
  },
): Promise<{ scope: PrivacyScope; householdId: string | null }> {
  return resolveRecordVisibility(store, input, {
    recordNoun: "asset",
    recordNounWithArticle: "an asset",
    fail: (message) => new AssetValidationError(message),
  });
}

/** Records a share row per selected member so a shared Asset reaches exactly them. */
export async function writeAssetShares(
  store: AssetLifecycleStore,
  input: {
    householdId: string;
    assetId: string;
    ownerUserId: string;
    selectedUserIds: string[];
  },
): Promise<void> {
  for (const sharedWithUserId of input.selectedUserIds) {
    await store.createHouseholdRecordShare({
      householdId: input.householdId,
      recordKind: "asset",
      recordId: input.assetId,
      sharedWithUserId,
      sharedByUserId: input.ownerUserId,
    });
  }
}

/**
 * Loads the Asset the acting user is talking about, whichever form it takes.
 *
 * The owner-keyed read runs first because it is the common private case and
 * because it is the only path that can reach a review-gated proposal. It is
 * accepted **only for a member-owned row**: a household-native Asset's
 * `ownerUserId` is a storage key, and honouring it as an access path would leave
 * the creating member reading and editing the household's refrigerator after
 * they had moved out — the one thing workspace ownership exists to prevent
 * (ADR 0214). Household-native rows therefore always come through the
 * scope-visible read, which requires current active membership.
 *
 * A not-found and a not-visible are indistinguishable on purpose.
 */
async function findVisibleAsset(
  store: AssetLifecycleStore,
  input: { callerUserId: string; assetId: string },
): Promise<Asset | null> {
  const asset = await resolveOwnedOrVisible({
    owned: () => store.getAsset({ ownerUserId: input.callerUserId, assetId: input.assetId }),
    visible: () => store.getVisibleAsset(input),
  });
  // Durable records only: a suggested proposal (or a dismissed husk) is never a
  // surface-readable Asset, even for its owner — review reaches proposals through
  // its own owner-scoped seam (#198).
  return asset && isDurableAssetStatus(asset.status) ? asset : null;
}

/**
 * Records an internal Asset Audit event for a write: what happened, who acted,
 * where the write came from, and the scope the asset held at write time (#197).
 * Audit is internal-first — never a user-facing history feed (#196). Shared with
 * the review lifecycle (#198) so proposal and memory writes ride the same trail.
 */
export async function recordAudit(
  store: AssetLifecycleStore,
  asset: Asset,
  event: {
    kind: AssetAuditEventKind;
    actorUserId: string;
    source: AssetAuditSource;
    detail: Record<string, unknown>;
  },
): Promise<void> {
  await store.createAssetAuditEvent({
    assetId: asset.id,
    ownerUserId: asset.ownerUserId,
    kind: event.kind,
    actorUserId: event.actorUserId,
    source: event.source,
    scope: asset.scope,
    detailJson: event.detail,
  });
}

/** Hydrates an asset with its scope audience detail (shared count, household name). */
async function hydrateAsset(store: AssetLifecycleStore, asset: Asset): Promise<AssetWithContext> {
  const shares =
    asset.scope === "shared" && asset.householdId
      ? await store.listHouseholdRecordShares({
          householdId: asset.householdId,
          recordKind: "asset",
          recordId: asset.id,
        })
      : [];
  const household =
    asset.scope !== "private" && asset.householdId
      ? await store.getHouseholdWorkspace({ householdId: asset.householdId })
      : null;
  return {
    ...asset,
    sharedWithCount: shares.length,
    sharedWithUserIds: shares.map((share) => share.sharedWithUserId),
    householdName: household?.name ?? null,
  };
}

/**
 * Applies an archive/restore transition through the validated domain matrix,
 * stamping actor provenance on the record and in the audit trail. The record's
 * owner keys the write; the acting user is recorded as the actor, so a member
 * acting on a household asset preserves owner provenance while recording who did
 * it (ADRs 0153, 0154).
 */
async function transitionAsset(
  store: AssetLifecycleStore,
  current: Asset,
  input: AssetActionInput & { source?: AssetAuditSource },
  action: "archive" | "restore",
): Promise<AssetWithContext> {
  const status = resolveAssetTransition(current.status, action);
  const patch: AssetPatch = {
    status,
    archivedAt: status === "archived" ? new Date() : null,
    lastActorUserId: input.actorUserId,
  };

  const updated = await store.updateAsset({
    ownerUserId: current.ownerUserId,
    assetId: current.id,
    patch,
  });

  await recordAudit(store, updated, {
    kind: action === "archive" ? "archived" : "restored",
    actorUserId: input.actorUserId,
    source: input.source ?? "user",
    detail: { previousStatus: current.status, status: updated.status },
  });

  return hydrateAsset(store, updated);
}

/**
 * Shared owner-scoped Asset lifecycle — the single source of truth for creating,
 * browsing, editing, and archiving Assets (Phase 6 #197). The web Assets surface
 * (and, later, Review Queue and Eve slices) are thin callers over these functions
 * so owner scoping, scope visibility, validated transitions, provenance, and the
 * internal Asset Audit trail never fork between surfaces. An Asset here is a
 * lightweight anchor: memories, evidence, links, snapshots, and search build on
 * this seam in later slices without reworking it (#196).
 */
export function createAssetLifecycle(store: AssetLifecycleStore, deps: AssetEmbeddingDeps = {}) {
  // Assets are semantically retrievable, so every write that changes what an asset
  // *is* — or whether it is durable at all — re-enqueues its embedding (#204).
  const embed = makeScheduleAssetEmbedding(deps);

  const { requireAssetAuthority, keepProvenAssets } = createAssetAuthority(store);

  /**
   * Loads the Asset and proves the operation about to happen against it.
   *
   * Every mutating path goes through here with the operation it is really
   * performing, rather than through a `requireOwnedAsset`-style read that bakes
   * "owner only" into which query runs. That is the whole shape of the Phase
   * Eight authority table: the same operation is owner-only on a member-owned
   * Asset and symmetric on a household-native one, and only the proof — reading
   * ownership form, current membership, and the current audience — can tell
   * which (ADR 0219).
   */
  async function requireAsset(
    input: AssetActionInput,
    operation: AssetAuthorityOperation,
  ): Promise<Asset> {
    const asset = await findVisibleAsset(store, {
      callerUserId: input.actorUserId,
      assetId: input.assetId,
    });
    // The same sentence a refused proof produces. "No such asset", "you may
    // not", and "you were removed from that household" have to be
    // indistinguishable from outside, because the difference between them is
    // exactly the protected fact (ADR 0219).
    if (!asset) {
      throw new HouseholdRecordUnavailableError();
    }
    await requireAssetAuthority({ actorUserId: input.actorUserId, asset, operation });
    return asset;
  }

  return {
    /**
     * Creates an active Asset as a lightweight anchor: name + kind + visibility,
     * with creator/actor provenance and a `created` audit event. Visibility
     * defaults to private and fail-closed; a shared scope materializes its share
     * rows before the audit write so the trail never precedes the audience.
     *
     * A `household_native` Asset takes `household` scope by definition rather
     * than by request — the workspace's refrigerator has no narrower audience to
     * choose — and the shared visibility guard still runs, so the creator's own
     * active membership is proved before the workspace is handed anything
     * (ADR 0214).
     */
    async createAsset(input: CreateActiveAssetInput): Promise<AssetWithContext> {
      const ownership = input.ownership ?? "member_owned";
      const { scope, householdId } = await resolveAssetVisibility(store, {
        ...input,
        ...(ownership === "household_native" ? { scope: "household" as const } : {}),
      });

      const asset = await store.createAsset({
        ownerUserId: input.ownerUserId,
        name: input.name,
        kind: input.kind,
        status: "active",
        scope,
        ownership,
        householdId,
        archivedAt: null,
        createdByUserId: input.ownerUserId,
        lastActorUserId: input.ownerUserId,
      });

      if (scope === "shared" && householdId) {
        await writeAssetShares(store, {
          householdId,
          assetId: asset.id,
          ownerUserId: input.ownerUserId,
          selectedUserIds: input.selectedUserIds ?? [],
        });
      }

      await recordAudit(store, asset, {
        kind: "created",
        actorUserId: input.ownerUserId,
        source: input.source ?? "user",
        detail: { name: asset.name, kind: asset.kind, scope: asset.scope, ownership },
      });
      await embed.asset(asset);

      return hydrateAsset(store, asset);
    },

    /**
     * Edits an Asset's content (name, kind) in place.
     *
     * Authority, not ownership: the owner of a member-owned Asset may re-author
     * it however wide its audience, and every active member may re-author the
     * household's own. An archived Asset is read-only until restored either way.
     *
     * A stale `expectedRevision` preserves the editor's draft and reports the
     * current value rather than overwriting it — the jointly-maintained case is
     * the whole reason the fence exists, and last-write-wins on a record two
     * people are editing is data loss with a friendly face.
     */
    async editAsset(input: EditAssetInput): Promise<AssetWithContext> {
      const asset = await requireAsset(input, "edit");
      assertAssetEditable(asset.status);
      assertAssetRecordFresh({
        expectedRevision: input.expectedRevision,
        current: asset,
        currentValue: asset.name,
        message: ASSET_STALE_WRITE_MESSAGE,
      });
      const edit = assetEditSchema.parse(input.edit);
      if (isEmptyAssetEdit(edit)) {
        throw new AssetValidationError("An asset edit must change the name or kind.");
      }

      // The audit detail carries before/after values so the trail can answer
      // *what* changed, not just that an edit happened.
      const patch: AssetPatch = { lastActorUserId: input.actorUserId };
      const detail: Record<string, unknown> = {};
      if (edit.name !== undefined) {
        patch.name = edit.name;
        detail.nameFrom = asset.name;
        detail.nameTo = edit.name;
      }
      if (edit.kind !== undefined) {
        patch.kind = edit.kind;
        detail.kindFrom = asset.kind;
        detail.kindTo = edit.kind;
      }

      const updated = await store.updateAsset({
        ownerUserId: asset.ownerUserId,
        assetId: asset.id,
        patch,
      });

      await recordAudit(store, updated, {
        kind: "edited",
        actorUserId: input.actorUserId,
        source: input.source ?? "user",
        detail,
      });
      // A renamed or re-kinded asset embeds different text — re-embed it.
      await embed.asset(updated);

      return hydrateAsset(store, updated);
    },

    /**
     * Archives an Asset — the normal inactive path; history stays intact (#196),
     * and for a household-native Asset it is the *only* removal path (ADR 0214).
     */
    async archiveAsset(input: AssetActionInput & { source?: AssetAuditSource }) {
      const current = await requireAsset(input, "archive");
      const archived = await transitionAsset(store, current, input, "archive");
      await embed.asset({ id: archived.id, ownerUserId: archived.ownerUserId });

      return archived;
    },

    /** Restores an archived Asset back to active. */
    async restoreAsset(input: AssetActionInput & { source?: AssetAuditSource }) {
      // One authority question: setting an Asset aside and bringing it back.
      const current = await requireAsset(input, "archive");
      const restored = await transitionAsset(store, current, input, "restore");
      await embed.asset({ id: restored.id, ownerUserId: restored.ownerUserId });

      return restored;
    },

    /**
     * Permanently removes an Asset for correction/privacy.
     *
     * Owner-only and intentionally separate from archive. The form rule refuses
     * it outright on a household-native Asset before the proof is even asked:
     * no single member ends a workspace-owned record for everybody, and the
     * refusal names archive so there is something to do instead (ADR 0214).
     */
    async hardDeleteAsset(input: AssetActionInput): Promise<void> {
      const asset = await requireAsset(input, "delete");
      const deleted = await store.deleteAsset({
        ownerUserId: asset.ownerUserId,
        assetId: asset.id,
      });
      if (!deleted) throw new HouseholdRecordUnavailableError();
    },

    /**
     * Loads one asset the caller may see, hydrated for a profile read, or `null`.
     * Deterministic denial: a non-visible asset and a missing one are the same
     * `null`, so a caller can never distinguish "hidden from me" from "does not
     * exist" (ADR 0153).
     */
    async getAsset(input: {
      callerUserId: string;
      assetId: string;
    }): Promise<AssetWithContext | null> {
      const asset = await findVisibleAsset(store, input);
      return asset ? hydrateAsset(store, asset) : null;
    },

    /**
     * The assets the caller may see — their own plus household and selected-shared
     * ones owned by active co-members — narrowed by the surface's kind/lifecycle/
     * visibility filters.
     *
     * Two gates, not one. The store's scope predicate narrows the query so
     * nothing out of scope is ever fetched; the proof then re-decides each row
     * against memberships read now, and drops what it refuses without leaving a
     * placeholder or a count behind. The predicate alone was the residual ADR
     * 0219 left for this issue: it is a pre-filter, and a pre-filter cannot see a
     * membership that ended after the page was built (#380, #386).
     */
    async listAssets(input: ListAssetsInput): Promise<AssetWithContext[]> {
      const assets = await store.listVisibleAssetsForCaller(input);
      const proven = await keepProvenAssets({
        callerUserId: input.callerUserId,
        rows: assets.map((asset) => ({ asset })),
      });
      return Promise.all(proven.map((row) => hydrateAsset(store, row.asset)));
    },

    /**
     * The internal Asset Audit trail for one asset, oldest first. Owner-scoped and
     * fail-closed: a caller who does not own the asset reads an empty trail rather
     * than learning it exists. Internal-first — distinct from user-facing history.
     */
    async listAssetAudit(input: ListAssetAuditInput) {
      return store.listAssetAuditEvents(input);
    },
  };
}
