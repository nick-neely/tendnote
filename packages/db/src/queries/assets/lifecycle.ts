import {
  type Asset,
  type AssetAuditEventKind,
  type AssetAuditSource,
  AssetValidationError,
  assertAssetEditable,
  assetEditSchema,
  isDurableAssetStatus,
  isEmptyAssetEdit,
  type PrivacyScope,
  resolveAssetTransition,
} from "@tendnote/domain";
import { resolveRecordVisibility } from "../households/record-visibility";
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
 * Loads an asset the caller may see, or `null`. Owner-scoped read first (the
 * common private case), then the scope-visible fallback so a household member
 * reaches an asset they can see. A not-found and a not-visible are
 * indistinguishable on purpose — fail closed, never confirm an asset the caller
 * may not see exists (ADR 0153).
 */
async function findVisibleAsset(
  store: AssetLifecycleStore,
  input: { callerUserId: string; assetId: string },
): Promise<Asset | null> {
  const asset =
    (await store.getAsset({ ownerUserId: input.callerUserId, assetId: input.assetId })) ??
    (await store.getVisibleAsset(input));
  // Durable records only: a suggested proposal (or a dismissed husk) is never a
  // surface-readable Asset, even for its owner — review reaches proposals through
  // its own owner-scoped seam (#198).
  return asset && isDurableAssetStatus(asset.status) ? asset : null;
}

/** Loads an asset the acting user may touch, or throws the deterministic denial. */
async function requireAsset(store: AssetLifecycleStore, input: AssetActionInput): Promise<Asset> {
  const asset = await findVisibleAsset(store, {
    callerUserId: input.actorUserId,
    assetId: input.assetId,
  });
  if (!asset) {
    throw new Error("Asset not found.");
  }
  return asset;
}

/**
 * Loads an asset the acting user *owns*, or throws. Owner-only operations —
 * editing content — never fall back to a scope-visible read: a member who can see
 * a household asset must not be able to re-author it (fail closed; ADR 0153).
 */
async function requireOwnedAsset(
  store: AssetLifecycleStore,
  input: AssetActionInput,
): Promise<Asset> {
  const asset = await store.getAsset({
    ownerUserId: input.actorUserId,
    assetId: input.assetId,
  });
  if (!asset) {
    throw new Error("Asset not found.");
  }
  return asset;
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
  return { ...asset, sharedWithCount: shares.length, householdName: household?.name ?? null };
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
  input: AssetActionInput & { source?: AssetAuditSource },
  action: "archive" | "restore",
): Promise<AssetWithContext> {
  const current = await requireAsset(store, input);
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
export function createAssetLifecycle(store: AssetLifecycleStore) {
  return {
    /**
     * Creates an active Asset as a lightweight anchor: name + kind + visibility,
     * with creator/actor provenance and a `created` audit event. Visibility
     * defaults to private and fail-closed; a shared scope materializes its share
     * rows before the audit write so the trail never precedes the audience.
     */
    async createAsset(input: CreateActiveAssetInput): Promise<AssetWithContext> {
      const { scope, householdId } = await resolveAssetVisibility(store, input);

      const asset = await store.createAsset({
        ownerUserId: input.ownerUserId,
        name: input.name,
        kind: input.kind,
        status: "active",
        scope,
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
        detail: { name: asset.name, kind: asset.kind, scope: asset.scope },
      });

      return hydrateAsset(store, asset);
    },

    /**
     * Edits an Asset's content (name, kind) in place. Owner-only and active-only:
     * a member who can see a shared/household asset may act on it but never
     * re-author it, and an archived asset is read-only until restored.
     */
    async editAsset(input: EditAssetInput): Promise<AssetWithContext> {
      const asset = await requireOwnedAsset(store, input);
      assertAssetEditable(asset.status);
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

      return hydrateAsset(store, updated);
    },

    /** Archives an Asset — the normal inactive path; history stays intact (#196). */
    archiveAsset(input: AssetActionInput & { source?: AssetAuditSource }) {
      return transitionAsset(store, input, "archive");
    },

    /** Restores an archived Asset back to active. */
    restoreAsset(input: AssetActionInput & { source?: AssetAuditSource }) {
      return transitionAsset(store, input, "restore");
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
     * visibility filters. Scope filtering is applied pre-retrieval by the store.
     */
    async listAssets(input: ListAssetsInput): Promise<AssetWithContext[]> {
      const assets = await store.listVisibleAssetsForCaller(input);
      return Promise.all(assets.map((asset) => hydrateAsset(store, asset)));
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
